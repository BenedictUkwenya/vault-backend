const router = require('express').Router();
const { createLimiter } = require('../config/rateLimit');
const studentLimiter = createLimiter('student-verify', {
  windowMs: 15 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => `student:${req.user?.id || req.ip}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Try again in 15 minutes.' },
});
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const subscriptionsController = require('../controllers/subscriptionsController');

router.get('/plans', asyncHandler(subscriptionsController.getPlans));
router.get('/status', authenticate, asyncHandler(subscriptionsController.getStatus));
router.post('/checkout', authenticate, asyncHandler(subscriptionsController.createCheckout));
router.post('/student/send-code', authenticate, studentLimiter, asyncHandler(subscriptionsController.sendStudentCode));
router.post('/student/verify', authenticate, studentLimiter, asyncHandler(subscriptionsController.verifyStudentCode));
router.post('/portal', authenticate, asyncHandler(subscriptionsController.createPortalSession));
router.post('/cancel', authenticate, asyncHandler(subscriptionsController.cancel));

module.exports = router;
