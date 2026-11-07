'use strict';
const { getKnex } = require('../config/database');
const T = 'savings_contributions';
const db = () => getKnex();

const listByGoal = (wsId, goalId) =>
  db()(T).where({ workspace_id: wsId, goal_id: goalId }).orderBy('date', 'desc');

const create = async (wsId, goalId, { date, amount, type = 'contribution', notes = '' }) => {
  const [id] = await db()(T).insert({
    workspace_id: wsId, goal_id: goalId,
    date, amount: Number(amount), type, notes,
  });
  return db()(T).where({ id }).first();
};

module.exports = { listByGoal, create };
