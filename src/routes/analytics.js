const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const analyticsController = require('../controllers/analyticsController');

const analyticsLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
});

router.use(analyticsLimiter);
router.post('/events', authenticate, asyncHandler(analyticsController.trackEvent));
router.post('/batch', optionalAuthenticate, asyncHandler(analyticsController.trackBatch));

module.exports = router;
