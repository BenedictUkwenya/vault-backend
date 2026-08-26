const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const authController = require('../controllers/authController');

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Too many attempts. Please try again later.' },
});

router.post(
  '/register',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').isLength({ min: 8 }),
    body('full_name').trim().notEmpty(),
  ],
  asyncHandler(authController.register)
);

router.post(
  '/verify-email',
  otpLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('code').trim().isLength({ min: 4, max: 8 }),
    body('password').isLength({ min: 8 }),
  ],
  asyncHandler(authController.verifyEmail)
);

router.post(
  '/resend-verify',
  otpLimiter,
  [body('email').isEmail().normalizeEmail()],
  asyncHandler(authController.resendVerify)
);

router.post(
  '/login',
  [
    body('email').isEmail().normalizeEmail(),
    body('password').notEmpty(),
  ],
  asyncHandler(authController.login)
);

router.post('/logout', authenticate, asyncHandler(authController.logout));

router.post(
  '/forgot-password',
  otpLimiter,
  [body('email').isEmail().normalizeEmail()],
  asyncHandler(authController.forgotPassword)
);

router.post(
  '/reset-password-with-code',
  otpLimiter,
  [
    body('email').isEmail().normalizeEmail(),
    body('code').trim().isLength({ min: 4, max: 8 }),
    body('new_password').optional().isLength({ min: 8 }),
    body('password').optional().isLength({ min: 8 }),
  ],
  asyncHandler(authController.resetPasswordWithCode)
);

router.post(
  '/reset-password',
  authenticate,
  [body('password').isLength({ min: 8 })],
  asyncHandler(authController.resetPassword)
);

router.get('/me', authenticate, asyncHandler(authController.getMe));

module.exports = router;
