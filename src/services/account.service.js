'use strict';
const accountRepo  = require('../repositories/accountRepository');
const { notFound, conflict, badRequest } = require('../utils/errors');

async function list(wsId) {
  return accountRepo.list(wsId);
}

async function getOne(wsId, id) {
  const a = await accountRepo.findById(wsId, id);
  if (!a) throw notFound('Account not found.', 'ACCOUNT_NOT_FOUND');
  return a;
}

async function create(wsId, data) {
  const existing = await accountRepo.findByName(wsId, data.name);
  if (existing) throw conflict('An account with that name already exists.', { name: 'Duplicate' }, 'ACCOUNT_DUPLICATE');
  return accountRepo.create(wsId, data);
}

async function update(wsId, id, patch) {
  const existing = await accountRepo.findById(wsId, id);
  if (!existing) throw notFound('Account not found.', 'ACCOUNT_NOT_FOUND');
  if (patch.name && patch.name !== existing.name) {
    const dup = await accountRepo.findByName(wsId, patch.name);
    if (dup) throw conflict('An account with that name already exists.', { name: 'Duplicate' }, 'ACCOUNT_DUPLICATE');
  }
  return accountRepo.update(wsId, id, patch);
}

async function remove(wsId, id) {
  const existing = await accountRepo.findById(wsId, id);
  if (!existing) throw notFound('Account not found.', 'ACCOUNT_NOT_FOUND');
  await accountRepo.remove(wsId, id);
}

module.exports = { list, getOne, create, update, remove };
