'use strict';
/**
 * Assistant routes — mounted at /api/v1/workspaces/:workspaceId
 *
 * POST   /assistant/messages             send a message, get AI reply
 * GET    /assistant/conversations        list conversations for this user+workspace
 * GET    /assistant/conversations/:id    get full conversation with messages
 */
const express        = require('express');
const rateLimit      = require('express-rate-limit');
const authenticate   = require('../middleware/authenticate');
const loadMembership = require('../middleware/loadMembership');
const requirePermission = require('../middleware/requirePermission');
const asyncHandler   = require('../utils/asyncHandler');
const assistantSvc   = require('../services/assistant.service');
const { badRequest } = require('../utils/errors');

const router = express.Router({ mergeParams: true });
const guard  = [authenticate, loadMembership];
const wsId   = (req) => Number(req.params.workspaceId);

// Tighter rate limit on assistant (cost + abuse protection)
const assistantLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: 'RATE_LIMIT', message: 'Too many assistant requests. Please wait a minute.', fields: null } },
  skip: () => process.env.NODE_ENV === 'test',
});

router.post('/assistant/messages', assistantLimiter, ...guard, requirePermission('assistant.use'),
  asyncHandler(async (req, res) => {
    const { content, conversation_id } = req.body;
    if (!content) throw badRequest('content is required.', null, 'MISSING_CONTENT');
    const result = await assistantSvc.sendMessage(req.workspace, req.user.id, req.membership, content, conversation_id ?? null);
    res.json(result);
  }),
);

router.get('/assistant/conversations', ...guard, requirePermission('assistant.use'),
  asyncHandler(async (req, res) => {
    const convs = await assistantSvc.listConversations(wsId(req), req.user.id);
    res.json({ conversations: convs });
  }),
);

router.get('/assistant/conversations/:convId', ...guard, requirePermission('assistant.use'),
  asyncHandler(async (req, res) => {
    const conv = await assistantSvc.getConversation(wsId(req), req.user.id, Number(req.params.convId));
    res.json({ conversation: conv });
  }),
);

module.exports = router;
