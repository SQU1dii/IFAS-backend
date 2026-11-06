'use strict';
const catRepo = require('../repositories/categoryRepository');
const { notFound, conflict } = require('../utils/errors');

async function list(wsId, type) {
  return catRepo.list(wsId, type ? { type } : {});
}

async function getOne(wsId, id) {
  const c = await catRepo.findById(wsId, id);
  if (!c) throw notFound('Category not found.', 'CATEGORY_NOT_FOUND');
  return c;
}

async function create(wsId, data) {
  const existing = await catRepo.findByName(wsId, data.name);
  if (existing) throw conflict('A category with that name already exists.', { name: 'Duplicate' }, 'CATEGORY_DUPLICATE');
  return catRepo.create(wsId, data);
}

async function update(wsId, id, patch) {
  const existing = await catRepo.findById(wsId, id);
  if (!existing) throw notFound('Category not found.', 'CATEGORY_NOT_FOUND');
  if (patch.name && patch.name !== existing.name) {
    const dup = await catRepo.findByName(wsId, patch.name);
    if (dup) throw conflict('A category with that name already exists.', { name: 'Duplicate' }, 'CATEGORY_DUPLICATE');
  }
  return catRepo.update(wsId, id, patch);
}

async function remove(wsId, id) {
  const existing = await catRepo.findById(wsId, id);
  if (!existing) throw notFound('Category not found.', 'CATEGORY_NOT_FOUND');
  await catRepo.remove(wsId, id);
}

module.exports = { list, getOne, create, update, remove };
