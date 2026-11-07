'use strict';
/**
 * CSV Import routes — mounted at /api/v1/workspaces/:workspaceId
 *
 * POST /imports              → preview. Accepts JSON { rows: [...] } (frontend)
 *                              OR multipart file field "file" (legacy API).
 * POST /imports/:id/confirm  → commit accepted rows in one transaction
 * GET  /imports              → list past imports
 */
const express    = require('express');
const multer     = require('multer');
const authenticate      = require('../middleware/authenticate');
const loadMembership    = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const asyncHandler      = require('../utils/asyncHandler');
const importSvc         = require('../services/import.service');
const { parseImportCsv } = require('../utils/csvParser');
const { badRequest }     = require('../utils/errors');

const router  = express.Router({ mergeParams: true });
const guard   = [authenticate, loadMembership];
const upload  = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });
const wsId    = (req) => Number(req.params.workspaceId);

router.get('/imports', ...guard, requirePermission('transactions.import'),
  asyncHandler(async (req, res) => {
    const imports = await importSvc.listImports(wsId(req));
    res.json({ success: true, data: imports, meta: null, message: null });
  }),
);

// Upload + preview — supports both JSON {rows} (frontend) and multipart file.
router.post('/imports', ...guard, requirePermission('transactions.import'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    let rows, fileName;
    if (req.body && Array.isArray(req.body.rows)) {
      // Frontend sends pre-parsed row objects as JSON.
      rows = req.body.rows;
      fileName = req.body.file_name || 'rows.json';
    } else if (req.file) {
      // Legacy: CSV file upload.
      rows = parseImportCsv(req.file.buffer);
      fileName = req.file.originalname;
    } else {
      throw badRequest('Send either JSON { rows: [...] } or a CSV file as form-data field "file".', null, 'NO_ROWS');
    }
    const result = await importSvc.preview(wsId(req), req.user.id, rows, fileName);
    res.status(201).json({ success: true, data: result, meta: null, message: null });
  }),
);

// Confirm
router.post('/imports/:importId/confirm', ...guard, requirePermission('transactions.import'),
  asyncHandler(async (req, res) => {
    const result = await importSvc.confirm(wsId(req), req.user.id, Number(req.params.importId));
    res.json({ success: true, data: result, meta: null, message: null });
  }),
);

module.exports = router;
