'use strict';
const express = require('express');
const router  = express.Router();

router.get('/', (req, res) => res.json({ name: 'IFAS API', version: 'v1' }));

// Auth (global)
router.use('/auth', require('./auth.routes'));

// Workspaces + members + departments + roles
router.use('/workspaces', require('./workspace.routes'));

// Workspace-scoped financial resources
router.use('/workspaces/:workspaceId', require('./financial.routes'));
router.use('/workspaces/:workspaceId', require('./import.routes'));
router.use('/workspaces/:workspaceId', require('./budget.routes'));
router.use('/workspaces/:workspaceId', require('./analytics.routes'));

// Global reference data + notifications
router.use('/', require('./misc.routes'));

// Platform admin
router.use('/admin', require('./admin.routes'));

module.exports = router;
