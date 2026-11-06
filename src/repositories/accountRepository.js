'use strict';
const { getKnex } = require('../config/database');
const T = 'accounts';
const db = () => getKnex();

const list = (wsId) =>
  db()(T).where({ workspace_id: wsId }).orderBy('name');

const findById = (wsId, id) =>
  db()(T).where({ workspace_id: wsId, id }).first();

const findByName = (wsId, name) =>
  db()(T).where({ workspace_id: wsId }).where('name', name).first();

const create = async (wsId, { name, account_type, opening_balance = 0 }) => {
  const [id] = await db()(T).insert({ workspace_id: wsId, name, account_type, opening_balance });
  return findById(wsId, id);
};

const update = async (wsId, id, patch) => {
  await db()(T).where({ workspace_id: wsId, id }).update(patch);
  return findById(wsId, id);
};

const remove = (wsId, id) =>
  db()(T).where({ workspace_id: wsId, id }).del();

module.exports = { list, findById, findByName, create, update, remove };
