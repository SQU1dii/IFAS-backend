'use strict';
const express = require('express');
const router  = express.Router();

router.get('/', (req, res) => res.json({ name: 'IFAS API', version: 'v1' }));

router.use('/auth',       require('./auth.routes'));
router.use('/workspaces', require('./workspace.routes'));

// Financial routes are sub-mounted under workspaces
router.use('/workspaces/:workspaceId', require('./financial.routes'));
router.use('/workspaces/:workspaceId', require('./import.routes'));
router.use('/workspaces/:workspaceId', require('./budget.routes'));
router.use('/workspaces/:workspaceId', require('./dashboard.routes'));
router.use('/workspaces/:workspaceId', require('./analytics.routes'));
router.use('/workspaces/:workspaceId', require('./assistant.routes'));

// Platform admin
router.use('/admin', require('./admin.routes'));

module.exports = router;
