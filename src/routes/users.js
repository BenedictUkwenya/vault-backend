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
router.get('/favorites/:businessId/status', authenticate, asyncHandler(usersController.isFavorite));
router.post('/favorites/:businessId', authenticate, asyncHandler(usersController.toggleFavorite));
router.get('/deal-favorites', authenticate, asyncHandler(usersController.getDealFavorites));
router.get('/deal-favorites/:dealId/status', authenticate, asyncHandler(usersController.isDealFavorite));
router.post('/deal-favorites/:dealId', authenticate, asyncHandler(usersController.toggleDealFavorite));
router.get('/wallet/history', authenticate, asyncHandler(usersController.walletHistory));
router.post('/push-token', authenticate, asyncHandler(usersController.savePushToken));
router.post('/streak', authenticate, asyncHandler(usersController.bumpStreak));
router.delete('/account', authenticate, asyncHandler(usersController.deleteAccount));

module.exports = router;
