const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const usersController = require('../controllers/usersController');

router.get('/profile', authenticate, asyncHandler(usersController.getProfile));
router.patch(
  '/profile',
  authenticate,
  [body('full_name').optional().trim().notEmpty()],
  asyncHandler(usersController.updateProfile)
);
router.get('/savings', authenticate, asyncHandler(usersController.getSavings));
router.get('/favorites', authenticate, asyncHandler(usersController.getFavorites));
router.post('/favorites/:businessId', authenticate, asyncHandler(usersController.toggleFavorite));
router.get('/wallet/history', authenticate, asyncHandler(usersController.walletHistory));
router.post('/push-token', authenticate, asyncHandler(usersController.savePushToken));
router.post('/streak', authenticate, asyncHandler(usersController.bumpStreak));
router.delete('/account', authenticate, asyncHandler(usersController.deleteAccount));

module.exports = router;
