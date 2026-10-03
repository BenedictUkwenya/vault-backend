const router = require('express').Router();
const { createLimiter } = require('../config/rateLimit');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const aiController = require('../controllers/aiController');

const aiLimiter = createLimiter('ai', {
  windowMs: 15 * 60 * 1000,
  max: 30,
  keyGenerator: (req) => `ai:${req.user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'You’re chatting fast! Give Limi a few minutes and try again.' },
});

router.post('/chat', authenticate, aiLimiter, asyncHandler(aiController.chat));

module.exports = router;
