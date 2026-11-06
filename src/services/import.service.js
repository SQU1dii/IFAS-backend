'use strict';
/**
 * CSV Import service.
 *
 * Two-phase flow:
 *  1. POST /imports  (upload)   → parse → validate → preview
 *     Returns:
 *       accepted: rows that pass all checks
 *       duplicates: rows already in the DB (same date+amount+account+description)
 *       rejected:  rows with validation errors
 *     Nothing is written to the transactions table yet.
 *
 *  2. POST /imports/:id/confirm → insert accepted rows in ONE DB transaction
 *     Then recalculates budget alerts and requests an unusual-spending scan.
 *
 *  GET /imports/:id/rejected → download rejected rows as CSV
 *
 * Duplicate definition: same (txn_date, amount, account_id, description)
 * within the same workspace that already exists with status = POSTED.
 */
const { getKnex }      = require('../config/database');
const { parseImportCsv }= require('../utils/csvParser');
const txnRepo          = require('../repositories/transactionRepository');
const accountRepo      = require('../repositories/accountRepository');
const catRepo          = require('../repositories/categoryRepository');
const deptRepo         = require('../repositories/departmentRepository');
const budgetSvc        = require('./budget.service');
const { notFound, badRequest, conflict } = require('../utils/errors');
const { TRANSFER_CATEGORY_NAME } = require('../config/constants');

const db = () => getKnex();

const REQUIRED_HEADERS = ['date', 'description', 'amount', 'type', 'account'];
const TXN_TYPE_MAP = { INCOME: 'INCOME', EXPENSE: 'EXPENSE', TRANSFER: 'TRANSFER' };

// ── row-level validation ─────────────────────────────────────────────────────
function validateRow(row, idx) {
  const errors = [];
  if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) errors.push('date must be YYYY-MM-DD');
  if (!row.description || !row.description.trim()) errors.push('description required');
  const amt = Number(row.amount);
  if (!row.amount || isNaN(amt) || amt <= 0) errors.push('amount must be a positive number');
  if (!TXN_TYPE_MAP[row.type]) errors.push(`type must be INCOME, EXPENSE, or TRANSFER (got: ${row.type})`);
  if (!row.account || !row.account.trim()) errors.push('account required');
  if (row.type === 'TRANSFER' && !row.to_account) errors.push('to_account required for TRANSFER');
  return errors;
}

// ── preview (parse + validate, no DB writes) ─────────────────────────────────
async function preview(wsId, userId, buffer, fileName) {
  // Parse CSV
  let rows;
  try {
    rows = parseImportCsv(buffer);
  } catch (e) {
    throw badRequest(`CSV parse error: ${e.message}`, null, 'CSV_PARSE_ERROR');
  }

  if (!rows.length) throw badRequest('The CSV file is empty.', null, 'CSV_EMPTY');

  // Check required headers
  const firstRow = rows[0];
  const missingHeaders = REQUIRED_HEADERS.filter((h) => !(h in firstRow));
  if (missingHeaders.length) {
    throw badRequest(`Missing required CSV columns: ${missingHeaders.join(', ')}`, null, 'CSV_MISSING_HEADERS');
  }

  // Load workspace's accounts, categories, departments for name→id resolution
  const accounts    = await accountRepo.list(wsId);
  const categories  = await catRepo.list(wsId);
  const departments = await deptRepo.list(wsId);

  const accountByName  = Object.fromEntries(accounts.map((a) => [a.name.toLowerCase(), a]));
  const categoryByName = Object.fromEntries(categories.map((c) => [c.name.toLowerCase(), c]));
  const deptByName     = Object.fromEntries(departments.map((d) => [d.name.toLowerCase(), d]));

  // Load existing POSTED transactions for duplicate detection
  const existingTxns = await db()('transactions')
    .where({ workspace_id: wsId, status: 'POSTED' })
    .select('txn_date', 'amount', 'account_id', 'description');

  const existingSet = new Set(
    existingTxns.map((t) => `${t.txn_date}|${Number(t.amount)}|${t.account_id}|${t.description.toLowerCase()}`)
  );

  const accepted   = [];
  const duplicates = [];
  const rejected   = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // 1-based, +1 for header

    // Schema validation
    const errors = validateRow(row, rowNum);
    if (errors.length) {
      rejected.push({ row_number: rowNum, ref: row.ref || '', data: row, reasons: errors });
      continue;
    }

    // Resolve account
    const account = accountByName[row.account.toLowerCase()];
    if (!account) {
      rejected.push({ row_number: rowNum, ref: row.ref || '', data: row, reasons: [`account '${row.account}' not found in workspace`] });
      continue;
    }

    // Resolve to_account for TRANSFER
    let toAccount = null;
    if (row.type === 'TRANSFER') {
      toAccount = row.to_account ? accountByName[row.to_account.toLowerCase()] : null;
      if (!toAccount) {
        rejected.push({ row_number: rowNum, ref: row.ref || '', data: row, reasons: [`to_account '${row.to_account}' not found in workspace`] });
        continue;
      }
      if (toAccount.id === account.id) {
        rejected.push({ row_number: rowNum, ref: row.ref || '', data: row, reasons: ['account and to_account must differ'] });
        continue;
      }
    }

    // Resolve category
    let category = null;
    if (row.type !== 'TRANSFER') {
      if (!row.category) {
        rejected.push({ row_number: rowNum, ref: row.ref || '', data: row, reasons: ['category required for INCOME/EXPENSE'] });
        continue;
      }
      category = categoryByName[row.category.toLowerCase()];
      if (!category) {
        // Auto-create category on import is not supported — reject with explanation
        rejected.push({ row_number: rowNum, ref: row.ref || '', data: row, reasons: [`category '${row.category}' not found. Create it first via the categories API.`] });
        continue;
      }
    }

    // Resolve department (optional, ORGANIZATION)
    let department = null;
    if (row.department && row.department.trim()) {
      department = deptByName[row.department.toLowerCase()];
      if (!department) {
        rejected.push({ row_number: rowNum, ref: row.ref || '', data: row, reasons: [`department '${row.department}' not found in workspace`] });
        continue;
      }
    }

    const amount = Number(row.amount);
    const dupKey = `${row.date}|${amount}|${account.id}|${row.description.toLowerCase()}`;

    const resolved = {
      txn_type:     row.type,
      amount,
      txn_date:     row.date,
      description:  row.description,
      account_id:   account.id,
      to_account_id: toAccount?.id ?? null,
      category_id:  category?.id  ?? null,
      department_id: department?.id ?? null,
      ref:          row.ref || null,
    };

    if (existingSet.has(dupKey)) {
      duplicates.push({ row_number: rowNum, ref: row.ref || '', data: resolved, reason: 'Duplicate: same date, amount, account, and description already exist.' });
    } else {
      accepted.push({ row_number: rowNum, ref: row.ref || '', data: resolved });
    }
  }

  // Persist the preview record (status = PREVIEW)
  const [importId] = await db()('csv_imports').insert({
    workspace_id:    wsId,
    created_by:      userId,
    file_name:       fileName,
    status:          'PREVIEW',
    accepted_count:  accepted.length,
    duplicate_count: duplicates.length,
    rejected_count:  rejected.length,
    preview:         JSON.stringify({ accepted, duplicates, rejected }),
  });

  return {
    import_id:       importId,
    accepted_count:  accepted.length,
    duplicate_count: duplicates.length,
    rejected_count:  rejected.length,
    accepted:        accepted.slice(0, 50),  // cap for response size
    duplicates:      duplicates.slice(0, 50),
    rejected:        rejected.slice(0, 50),
  };
}

// ── confirm ───────────────────────────────────────────────────────────────────
async function confirm(wsId, userId, importId) {
  const importRecord = await db()('csv_imports').where({ workspace_id: wsId, id: importId }).first();
  if (!importRecord) throw notFound('Import not found.', 'IMPORT_NOT_FOUND');
  if (importRecord.status !== 'PREVIEW') {
    throw badRequest(`Import has already been ${importRecord.status.toLowerCase()}.`, null, 'IMPORT_ALREADY_PROCESSED');
  }

  const preview = JSON.parse(importRecord.preview || '{}');
  const accepted = preview.accepted || [];

  if (!accepted.length) throw badRequest('No accepted rows to import.', null, 'NOTHING_TO_IMPORT');

  const insertedIds = [];
  const affectedCategories = new Set();
  const affectedDepts      = new Set();
  const affectedDates      = new Set();

  await db().transaction(async (trx) => {
    for (const item of accepted) {
      const d = item.data;
      const txn = await txnRepo.create(wsId, userId, { ...d, import_id: importId }, trx);
      insertedIds.push(txn.id);
      if (d.category_id)   affectedCategories.add(d.category_id);
      if (d.department_id) affectedDepts.add(d.department_id);
      affectedDates.add(d.txn_date);
    }
    // Mark import confirmed
    await trx('csv_imports').where({ id: importId }).update({
      status: 'CONFIRMED', confirmed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  });

  // Recalculate budget alerts for every affected category/dept + date
  setImmediate(async () => {
    for (const catId of affectedCategories) {
      for (const date of affectedDates) {
        await budgetSvc.recalcAlerts(wsId, catId, null, date).catch(() => {});
      }
    }
    for (const deptId of affectedDepts) {
      for (const date of affectedDates) {
        await budgetSvc.recalcAlerts(wsId, null, deptId, date).catch(() => {});
      }
    }

    // Request unusual-spending scan (Stage 8)
    try {
      const analyticsSvc = require('./analytics.service');
      const sinceDate = Array.from(affectedDates).sort()[0];
      await analyticsSvc.scanUnusual(wsId, sinceDate);
    } catch { /* analytics unavailable — OK */ }
  });

  return { inserted_count: insertedIds.length, import_id: importId };
}

// ── get rejected CSV ──────────────────────────────────────────────────────────
async function getRejectedCsv(wsId, importId) {
  const importRecord = await db()('csv_imports').where({ workspace_id: wsId, id: importId }).first();
  if (!importRecord) throw notFound('Import not found.', 'IMPORT_NOT_FOUND');

  const preview  = JSON.parse(importRecord.preview || '{}');
  const rejected = preview.rejected || [];

  if (!rejected.length) return 'row_number,ref,date,description,amount,type,account,to_account,category,department,reasons\n';

  const lines = ['row_number,ref,date,description,amount,type,account,to_account,category,department,reasons'];
  for (const r of rejected) {
    const d = r.data || {};
    const reasons = (r.reasons || []).join('; ').replace(/"/g, '""');
    lines.push([r.row_number, r.ref, d.date || '', `"${(d.description || '').replace(/"/g, '""')}"`,
      d.amount || '', d.type || '', d.account || '', d.to_account || '',
      d.category || '', d.department || '', `"${reasons}"`].join(','));
  }
  return lines.join('\n');
}

async function listImports(wsId) {
  return db()('csv_imports').where({ workspace_id: wsId }).orderBy('created_at', 'desc')
    .select('id', 'file_name', 'status', 'accepted_count', 'duplicate_count', 'rejected_count', 'created_at', 'confirmed_at');
}

module.exports = { preview, confirm, getRejectedCsv, listImports };
