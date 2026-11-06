'use strict';
/**
 * CSV Import routes — mounted at /api/v1/workspaces/:workspaceId
 *
 * POST   /imports           upload CSV → preview (nothing saved)
 * POST   /imports/:id/confirm  commit accepted rows in one transaction
 * GET    /imports            list imports for this workspace
 * GET    /imports/:id/rejected  download rejected rows as CSV
 */
const express    = require('express');
const multer     = require('multer');
const authenticate      = require('../middleware/authenticate');
const loadMembership    = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const asyncHandler      = require('../utils/asyncHandler');
const importSvc         = require('../services/import.service');

const router  = express.Router({ mergeParams: true });
const guard   = [authenticate, loadMembership];
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const wsId = (req) => Number(req.params.workspaceId);

// List past imports
router.get('/imports', ...guard, requirePermission('transactions.import'),
  asyncHandler(async (req, res) => {
    res.json({ imports: await importSvc.listImports(wsId(req)) });
  }),
);

// Upload + preview
router.post('/imports', ...guard, requirePermission('transactions.import'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) throw require('../utils/errors').badRequest('No file uploaded. Send the CSV as form-data field "file".', null, 'NO_FILE');
    const result = await importSvc.preview(wsId(req), req.user.id, req.file.buffer, req.file.originalname);
    res.status(201).json(result);
  }),
);

// Confirm
router.post('/imports/:importId/confirm', ...guard, requirePermission('transactions.import'),
  asyncHandler(async (req, res) => {
    const result = await importSvc.confirm(wsId(req), req.user.id, Number(req.params.importId));
    res.json(result);
  }),
);

// Download rejected rows as CSV
router.get('/imports/:importId/rejected', ...guard, requirePermission('transactions.import'),
  asyncHandler(async (req, res) => {
    const csv = await importSvc.getRejectedCsv(wsId(req), Number(req.params.importId));
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="rejected_${req.params.importId}.csv"`);
    res.send(csv);
  }),
);

module.exports = router;
