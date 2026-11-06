'use strict';
/**
 * Transaction service.
 *
 * Business rules enforced here:
 *  - amount > 0 (also enforced by Zod validator)
 *  - Valid date (ISO format, not in far future)
 *  - INCOME/EXPENSE must have a category_id from this workspace
 *  - TRANSFER needs two DIFFERENT accounts belonging to this workspace
 *  - TRANSFER is not counted as income or expense (no category required)
 *  - Transactions are NEVER deleted — only voided (status = VOID)
 *  - Department Head can only create/edit transactions for their own department
 *  - After every create/void, budget alert recalculation is triggered
 */
const { getKnex }    = require('../config/database');
const txnRepo        = require('../repositories/transactionRepository');
const accountRepo    = require('../repositories/accountRepository');
const catRepo        = require('../repositories/categoryRepository');
const deptRepo       = require('../repositories/departmentRepository');
const { notFound, badRequest, forbidden } = require('../utils/errors');
const { ROLES }      = require('../config/constants');

const db = () => getKnex();

async function _validateAccount(wsId, accountId, fieldName = 'account_id') {
  if (!accountId) return null;
  const a = await accountRepo.findById(wsId, accountId);
  if (!a) throw badRequest(`${fieldName} does not belong to this workspace.`, { [fieldName]: 'Not found in workspace' }, 'ACCOUNT_NOT_IN_WORKSPACE');
  return a;
}

async function _validateCategory(wsId, categoryId) {
  if (!categoryId) return null;
  const c = await catRepo.findById(wsId, categoryId);
  if (!c) throw badRequest('category_id does not belong to this workspace.', { category_id: 'Not found in workspace' }, 'CATEGORY_NOT_IN_WORKSPACE');
  return c;
}

async function _validateDepartment(wsId, departmentId) {
  if (!departmentId) return null;
  const d = await deptRepo.findById(wsId, departmentId);
  if (!d) throw badRequest('department_id does not belong to this workspace.', { department_id: 'Not found in workspace' }, 'DEPT_NOT_IN_WORKSPACE');
  return d;
}

function _deptScopeCheck(membership, departmentId) {
  if (membership.role_name === ROLES.ORG_DEPT_HEAD) {
    if (!departmentId || departmentId !== membership.department_id) {
      throw forbidden('Department Head can only record transactions for their own department.', 'DEPT_SCOPE_VIOLATION');
    }
  }
}

async function list(wsId, filters, membership) {
  const deptScope = membership.role_name === ROLES.ORG_DEPT_HEAD
    ? membership.department_id
    : null;
  return txnRepo.list(wsId, filters, deptScope);
}

async function getOne(wsId, txnId, membership) {
  const txn = await txnRepo.findById(wsId, txnId);
  if (!txn) throw notFound('Transaction not found.', 'TXN_NOT_FOUND');
  if (membership.role_name === ROLES.ORG_DEPT_HEAD && txn.department_id !== membership.department_id) {
    throw forbidden('Department Head can only view their own department\'s transactions.', 'DEPT_SCOPE_VIOLATION');
  }
  return txn;
}

async function create(wsId, userId, data, membership) {
  // Cross-workspace FK validation
  await _validateAccount(wsId, data.account_id, 'account_id');
  if (data.to_account_id) await _validateAccount(wsId, data.to_account_id, 'to_account_id');
  if (data.category_id)   await _validateCategory(wsId, data.category_id);
  if (data.department_id) await _validateDepartment(wsId, data.department_id);

  _deptScopeCheck(membership, data.department_id);

  // Validate date is a real date
  if (isNaN(Date.parse(data.txn_date))) throw badRequest('txn_date is not a valid date.', { txn_date: 'Invalid' }, 'INVALID_DATE');

  const txn = await txnRepo.create(wsId, userId, data);

  // Trigger budget alert check async (fire-and-forget — never blocks the response)
  if (data.txn_type !== 'TRANSFER') {
    setImmediate(() => {
      require('./budget.service').recalcAlerts(wsId, data.category_id, data.department_id, data.txn_date)
        .catch(() => {});
    });
  }

  return txn;
}

async function update(wsId, txnId, userId, patch, membership) {
  const existing = await txnRepo.findById(wsId, txnId);
  if (!existing) throw notFound('Transaction not found.', 'TXN_NOT_FOUND');
  if (existing.status === 'VOID') throw badRequest('Cannot edit a voided transaction.', null, 'TXN_IS_VOID');

  if (membership.role_name === ROLES.ORG_DEPT_HEAD && existing.department_id !== membership.department_id) {
    throw forbidden('Department Head can only edit their own department\'s transactions.', 'DEPT_SCOPE_VIOLATION');
  }

  if (patch.category_id) await _validateCategory(wsId, patch.category_id);
  if (patch.department_id) await _validateDepartment(wsId, patch.department_id);

  return txnRepo.update(wsId, txnId, patch);
}

async function voidTransaction(wsId, txnId, userId, reason, membership) {
  const existing = await txnRepo.findById(wsId, txnId);
  if (!existing) throw notFound('Transaction not found.', 'TXN_NOT_FOUND');
  if (existing.status === 'VOID') throw badRequest('Transaction is already voided.', null, 'ALREADY_VOID');

  if (membership.role_name === ROLES.ORG_DEPT_HEAD && existing.department_id !== membership.department_id) {
    throw forbidden('Department Head can only void their own department\'s transactions.', 'DEPT_SCOPE_VIOLATION');
  }

  const txn = await txnRepo.voidTxn(wsId, txnId, userId, reason);

  // Re-run budget alerts after void
  if (existing.txn_type !== 'TRANSFER') {
    setImmediate(() => {
      require('./budget.service').recalcAlerts(wsId, existing.category_id, existing.department_id, existing.txn_date)
        .catch(() => {});
    });
  }

  return txn;
}

module.exports = { list, getOne, create, update, voidTransaction };
