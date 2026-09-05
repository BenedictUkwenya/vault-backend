const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const analyticsController = require('../controllers/analyticsController');

// Auth optional-ish: prefer authenticated, but allow if middleware fails? Require auth for now.
router.post('/events', authenticate, asyncHandler(analyticsController.trackEvent));

module.exports = router;
