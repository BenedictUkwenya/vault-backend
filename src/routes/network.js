const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const networkController = require('../controllers/networkController');

const applyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many applications from this network. Please try again later.' },
});

// Public — Black Limitless Network website applications
router.post('/apply', applyLimiter, asyncHandler(networkController.apply));

// Admin review
router.get('/applications', authenticate, requireAdmin, asyncHandler(networkController.list));
router.patch(
  '/applications/:id',
  authenticate,
  requireAdmin,
  asyncHandler(networkController.updateStatus)
);

module.exports = router;
