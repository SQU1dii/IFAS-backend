'use strict';
const express        = require('express');
const authenticate   = require('../middleware/authenticate');
const loadMembership = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const asyncHandler   = require('../utils/asyncHandler');
const analyticsSvc   = require('../services/analytics.service');

const router = express.Router({ mergeParams: true });
const guard  = [authenticate, loadMembership];
const wsId   = (req) => Number(req.params.workspaceId);

// GET /forecast?category_id=&horizon=6
router.get('/forecast', ...guard, requirePermission('analytics.view'),
  asyncHandler(async (req, res) => {
    const categoryId = req.query.category_id ? Number(req.query.category_id) : null;
    const horizon    = Math.min(24, Math.max(1, Number(req.query.horizon ?? 6)));
    const result = await analyticsSvc.forecast(wsId(req), categoryId, horizon);
    res.json({ forecast: result });
  }),
);

// GET /recommendations
router.get('/recommendations', ...guard, requirePermission('analytics.view'),
  asyncHandler(async (req, res) => {
    const recs = await analyticsSvc.listRecommendations(wsId(req));
    res.json({ recommendations: recs });
  }),
);

// POST /recommendations/refresh
router.post('/recommendations/refresh', ...guard, requirePermission('analytics.view'),
  asyncHandler(async (req, res) => {
    const recs = await analyticsSvc.getRecommendations(wsId(req), req.workspace.workspace_type);
    res.json({ recommendations: recs });
  }),
);

// DELETE /recommendations/:recId
router.delete('/recommendations/:recId', ...guard, requirePermission('analytics.view'),
  asyncHandler(async (req, res) => {
    await analyticsSvc.dismissRecommendation(wsId(req), Number(req.params.recId));
    res.json({ message: 'Recommendation dismissed.' });
  }),
);

module.exports = router;
