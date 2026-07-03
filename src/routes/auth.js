const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const authController = require('../controllers/authController');

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
  [body('email').isEmail().normalizeEmail()],
  asyncHandler(authController.forgotPassword)
);

router.post(
  '/reset-password',
  authenticate,
  [body('password').isLength({ min: 8 })],
  asyncHandler(authController.resetPassword)
);

router.get('/me', authenticate, asyncHandler(authController.getMe));

module.exports = router;
