'use strict';
const express        = require('express');
const authenticate   = require('../middleware/authenticate');
const loadMembership = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const asyncHandler   = require('../utils/asyncHandler');
const dashSvc        = require('../services/dashboard.service');
const txnRepo        = require('../repositories/transactionRepository');
const { stringify }  = require('csv-stringify/sync');

const router = express.Router({ mergeParams: true });
const guard  = [authenticate, loadMembership];
const wsId   = (req) => Number(req.params.workspaceId);

// GET /dashboard
router.get('/dashboard', ...guard, requirePermission('dashboard.view'),
  asyncHandler(async (req, res) => {
    const data = await dashSvc.getDashboard(req.workspace, req.membership);
    res.json({ dashboard: data });
  }),
);

// GET /reports?format=csv&date_from=&date_to=&txn_type=
router.get('/reports', ...guard, requirePermission('reports.generate'),
  asyncHandler(async (req, res) => {
    const { page_size = 5000, ...filters } = req.query;
    const deptScope = req.membership.role_name === 'ORGANIZATION Department Head'
      ? req.membership.department_id : null;

    const result = await txnRepo.list(wsId(req), { ...filters, page: 1, page_size }, deptScope);

    const rows = result.data.map((t) => ({
      id:          t.id,
      txn_date:    t.txn_date,
      description: t.description,
      txn_type:    t.txn_type,
      amount:      t.amount,
      status:      t.status,
      account_id:  t.account_id,
      category_id: t.category_id,
      department_id: t.department_id,
    }));

    try {
      const csv = stringify(rows, { header: true });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="transactions_${wsId(req)}.csv"`);
      return res.send(csv);
    } catch {
      // csv-stringify not installed — fall back to plain JSON
      res.json({ transactions: rows, total: result.total });
    }
  }),
);

module.exports = router;
