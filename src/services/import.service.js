'use strict';
/**
 * CSV Import service — aligned to the frontend contract.
 *
 * Flow:
 *   POST /imports           body { rows: [...] }  → preview (nothing saved)
 *       Returns { import_id, preview, total, valid, rejected }
 *         preview = [{ row, data, errors, valid }]
 *   POST /imports/:id/confirm                  → commit accepted rows in one txn
 *       Returns { imported, transactions }
 *
 * Also still supports multipart file upload (req.file) — the route converts
 * the file to rows before calling preview().
 *
 * Duplicate = same (txn_date, amount, account, description) already POSTED.
 */
const { getKnex }      = require('../config/database');
const txnRepo          = require('../repositories/transactionRepository');
const accountRepo      = require('../repositories/accountRepository');
const catRepo          = require('../repositories/categoryRepository');
const deptRepo         = require('../repositories/departmentRepository');
const budgetSvc        = require('./budget.service');
const { parseImportCsv }= require('../utils/csvParser');
const { mapTransaction }= require('../utils/mappers');
const { notFound, badRequest } = require('../utils/errors');

const db = () => getKnex();

const REQUIRED = ['date', 'description', 'amount', 'type', 'account'];

function validateRow(row) {
  const errors = [];
  if (!row.date || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) errors.push({ field: 'date', message: 'date must be YYYY-MM-DD' });
  if (!row.description || !String(row.description).trim()) errors.push({ field: 'description', message: 'description is required' });
  const amt = Number(row.amount);
  if (isNaN(amt) || amt <= 0) errors.push({ field: 'amount', message: 'amount must be a positive number' });
  if (!['income', 'expense', 'transfer'].includes(String(row.type || '').toLowerCase()))
    errors.push({ field: 'type', message: 'type must be income, expense, or transfer' });
  if (!row.account) errors.push({ field: 'account', message: 'account is required' });
  if (String(row.type || '').toLowerCase() === 'transfer' && !row.to_account)
    errors.push({ field: 'to_account', message: 'to_account is required for transfer' });
  return errors;
}

async function preview(wsId, userId, rows, fileName = 'rows.json') {
  if (!Array.isArray(rows) || !rows.length) throw badRequest('No rows to import.', null, 'CSV_EMPTY');

  const [accounts, categories, departments] = await Promise.all([
    accountRepo.list(wsId), catRepo.list(wsId), deptRepo.list(wsId),
  ]);
  const accByName  = Object.fromEntries(accounts.map((a) => [a.name.toLowerCase(), a]));
  const catByName  = Object.fromEntries(categories.map((c) => [c.name.toLowerCase(), c]));
  const deptByName = Object.fromEntries(departments.map((d) => [d.name.toLowerCase(), d]));

  const existing = await db()('transactions')
    .where({ workspace_id: wsId, status: 'POSTED' })
    .select('txn_date', 'amount', 'account_id', 'description');
  const existingSet = new Set(existing.map((t) => `${t.txn_date}|${Number(t.amount)}|${t.account_id}|${String(t.description).toLowerCase()}`));

  const previewRows = [];
  let valid = 0;
  let rejected = 0;
  const accepted = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const errors = validateRow(raw);

    let resolved = null;
    if (!errors.length) {
      const account = accByName[String(raw.account).toLowerCase()];
      if (!account) errors.push({ field: 'account', message: `account '${raw.account}' not found` });
      else {
        let toAccount = null;
        if (String(raw.type).toLowerCase() === 'transfer') {
          toAccount = raw.to_account ? accByName[String(raw.to_account).toLowerCase()] : null;
          if (!toAccount) errors.push({ field: 'to_account', message: `to_account '${raw.to_account}' not found` });
          else if (toAccount.id === account.id) errors.push({ field: 'to_account', message: 'account and to_account must differ' });
        }
        let category = null;
        if (String(raw.type).toLowerCase() !== 'transfer') {
          if (!raw.category) errors.push({ field: 'category', message: 'category required for income/expense' });
          else {
            category = catByName[String(raw.category).toLowerCase()];
            if (!category) errors.push({ field: 'category', message: `category '${raw.category}' not found` });
          }
        }
        let department = null;
        if (raw.department && String(raw.department).trim()) {
          department = deptByName[String(raw.department).toLowerCase()];
          if (!department) errors.push({ field: 'department', message: `department '${raw.department}' not found` });
        }
        if (!errors.length) {
          resolved = {
            txn_type: String(raw.type).toUpperCase(),
            amount: Number(raw.amount),
            txn_date: raw.date,
            description: raw.description,
            account_id: account.id,
            to_account_id: toAccount?.id ?? null,
            category_id: category?.id ?? null,
            department_id: department?.id ?? null,
          };
        }
      }
    }

    const isDuplicate = resolved ? existingSet.has(`${resolved.txn_date}|${resolved.amount}|${resolved.account_id}|${resolved.description.toLowerCase()}`) : false;

    if (errors.length) {
      rejected++;
      previewRows.push({ row: i + 1, data: raw, errors, valid: false });
    } else if (isDuplicate) {
      previewRows.push({ row: i + 1, data: resolved, errors: [{ field: '*', message: 'Duplicate: same date, amount, account, and description already exist.' }], valid: false, duplicate: true });
    } else {
      valid++;
      accepted.push({ row: i + 1, data: resolved });
      previewRows.push({ row: i + 1, data: resolved, errors: [], valid: true });
    }
  }

  // Persist the preview record.
  const [importId] = await db()('csv_imports').insert({
    workspace_id: wsId, created_by: userId, file_name: fileName,
    status: 'PREVIEW',
    accepted_count: valid, duplicate_count: previewRows.filter((r) => r.duplicate).length, rejected_count: rejected,
    preview: JSON.stringify({ accepted, preview: previewRows }),
  });

  return { import_id: importId, preview: previewRows, total: rows.length, valid, rejected };
}

async function confirm(wsId, userId, importId) {
  const record = await db()('csv_imports').where({ workspace_id: wsId, id: importId }).first();
  if (!record) throw notFound('Import not found.', 'IMPORT_NOT_FOUND');
  if (record.status !== 'PREVIEW') throw badRequest(`Import has already been ${record.status.toLowerCase()}.`, null, 'IMPORT_ALREADY_PROCESSED');

  const stored = JSON.parse(record.preview || '{}');
  const accepted = stored.accepted || [];
  if (!accepted.length) throw badRequest('No accepted rows to import.', null, 'NOTHING_TO_IMPORT');

  const inserted = [];
  const affectedCats = new Set();
  const affectedDates = new Set();

  await db().transaction(async (trx) => {
    for (const item of accepted) {
      const txn = await txnRepo.create(wsId, userId, { ...item.data, import_id: importId }, trx);
      inserted.push(txn);
      if (txn.category_id) affectedCats.add(txn.category_id);
      affectedDates.add(txn.txn_date);
    }
    await trx('csv_imports').where({ id: importId }).update({
      status: 'CONFIRMED', confirmed_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
    });
  });

  // Recalc budgets + unusual-spending scan (best-effort, async).
  setImmediate(async () => {
    for (const catId of affectedCats) {
      for (const date of affectedDates) await budgetSvc.recalcAlerts(wsId, catId, null, date).catch(() => {});
    }
    try { await require('./analytics.service').scanUnusual(wsId, Array.from(affectedDates).sort()[0]); } catch {}
  });

  // Enrich transactions with names for the response.
  const [accounts, categories] = await Promise.all([accountRepo.list(wsId), catRepo.list(wsId)]);
  const accName = Object.fromEntries(accounts.map((a) => [a.id, a.name]));
  const catName = Object.fromEntries(categories.map((c) => [c.id, c.name]));
  const mapped = inserted.map((t) => mapTransaction(t, {
    categoryName: t.category_id ? catName[t.category_id] : null,
    accountName: accName[t.account_id] || '',
    destAccountName: t.to_account_id ? accName[t.to_account_id] : null,
  }));

  return { imported: mapped.length, transactions: mapped };
}

async function listImports(wsId) {
  return db()('csv_imports').where({ workspace_id: wsId }).orderBy('created_at', 'desc')
    .select('id', 'file_name', 'status', 'accepted_count', 'duplicate_count', 'rejected_count', 'created_at', 'confirmed_at');
}

module.exports = { preview, confirm, listImports };
