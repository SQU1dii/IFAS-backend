'use strict';
const { getKnex } = require('../config/database');
const db = () => getKnex();

const list = (wsId, { status } = {}) => {
  let q = db()('alerts').where({ workspace_id: wsId }).orderBy('created_at', 'desc');
  if (status) q = q.where({ status });
  return q;
};

const listOpen = (wsId, { limit = 10 } = {}) =>
  db()('alerts').where({ workspace_id: wsId, status: 'OPEN' }).orderBy('created_at', 'desc').limit(limit);

const findById = (wsId, id) => db()('alerts').where({ workspace_id: wsId, id }).first();

const countOpen = async (wsId) => {
  const rows = await db()('alerts').where({ workspace_id: wsId, status: 'OPEN' }).count('id as cnt');
  return Number(rows[0]?.cnt ?? 0);
};

const update = (id, patch) => db()('alerts').where({ id }).update(patch);

module.exports = { list, listOpen, findById, countOpen, update };
