'use strict';
const { getKnex } = require('../config/database');
const T = 'transactions';
const db = () => getKnex();

/** List transactions with optional filters and cursor-based pagination. */
async function list(wsId, filters = {}, departmentScope = null) {
  const {
    page = 1, page_size = 50,
    txn_type, status, account_id, category_id, department_id,
    date_from, date_to,
  } = filters;

  let q = db()(T).where({ workspace_id: wsId });

  // Department Head scope: only see their department
  if (departmentScope) q = q.where({ department_id: departmentScope });

  if (txn_type)     q = q.where({ txn_type });
  if (status)       q = q.where({ status });
  if (account_id)   q = q.where({ account_id: Number(account_id) });
  if (category_id)  q = q.where({ category_id: Number(category_id) });
  if (department_id) q = q.where({ department_id: Number(department_id) });
  if (date_from)    q = q.where('txn_date', '>=', date_from);
  if (date_to)      q = q.where('txn_date', '<=', date_to);

  const countQ = q.clone().count('id as cnt');
  const [{ cnt }] = await countQ;

  q = q.orderBy('txn_date', 'desc').orderBy('id', 'desc')
       .limit(Number(page_size))
       .offset((Number(page) - 1) * Number(page_size));

  const rows = await q;
  return { data: rows, total: Number(cnt), page: Number(page), page_size: Number(page_size) };
}

const findById = (wsId, id) =>
  db()(T).where({ workspace_id: wsId, id }).first();

async function create(wsId, userId, data, trx) {
  const db_ = trx || db();
  const [id] = await db_(T).insert({
    workspace_id: wsId,
    created_by:   userId,
    txn_type:     data.txn_type,
    amount:       data.amount,
    txn_date:     data.txn_date,
    description:  data.description,
    account_id:   data.account_id,
    to_account_id: data.to_account_id   ?? null,
    category_id:  data.category_id      ?? null,
    department_id: data.department_id   ?? null,
    import_id:    data.import_id        ?? null,
    status:       'POSTED',
  });
  return (trx || db())(T).where({ workspace_id: wsId, id }).first();
}

async function update(wsId, id, patch) {
  await db()(T).where({ workspace_id: wsId, id }).update(patch);
  return findById(wsId, id);
}

async function voidTxn(wsId, id, userId, reason) {
  await db()(T).where({ workspace_id: wsId, id }).update({
    status:     'VOID',
    void_reason: reason ?? null,
    voided_by:  userId,
    voided_at:  new Date().toISOString().slice(0, 19).replace('T', ' '),
  });
  return findById(wsId, id);
}

/** Monthly expense totals for a workspace, used by forecast. */
async function monthlyExpenseTotals(wsId, categoryId = null) {
  let q = db()(T)
    .where({ workspace_id: wsId, txn_type: 'EXPENSE', status: 'POSTED' });
  if (categoryId) q = q.where({ category_id: categoryId });
  const rows = await q;

  // Group by YYYY-MM-01 in JS (avoids raw SQL for mock compatibility)
  const map = new Map();
  for (const r of rows) {
    const month = String(r.txn_date).slice(0, 7) + '-01';
    map.set(month, (map.get(month) ?? 0) + Number(r.amount));
  }
  return Array.from(map.entries())
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([month, total_expense]) => ({ month, total_expense }));
}

/** Sum of POSTED EXPENSE transactions for a workspace/category/department in a date range. */
async function sumExpenses(wsId, { categoryId, departmentId, dateFrom, dateTo } = {}, trx) {
  const db_ = trx || db();
  let q = db_(T).where({ workspace_id: wsId, txn_type: 'EXPENSE', status: 'POSTED' });
  if (categoryId)   q = q.where({ category_id: categoryId });
  if (departmentId) q = q.where({ department_id: departmentId });
  if (dateFrom)     q = q.where('txn_date', '>=', dateFrom);
  if (dateTo)       q = q.where('txn_date', '<=', dateTo);
  const rows = await q.sum('amount as total');
  return Number(rows[0]?.total ?? 0);
}

/** Fetch recent POSTED transactions for unusual-spending scan (no PII descriptions in aggregated form). */
async function recentForScan(wsId, sinceDate) {
  return db()(T)
    .where({ workspace_id: wsId, txn_type: 'EXPENSE', status: 'POSTED' })
    .where('txn_date', '>=', sinceDate)
    .select('id', 'amount', 'txn_date', 'category_id', 'department_id', 'account_id');
}

module.exports = { list, findById, create, update, voidTxn, monthlyExpenseTotals, sumExpenses, recentForScan };
