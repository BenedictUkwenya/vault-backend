const router = require('express').Router();
const { body, query } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const businessesController = require('../controllers/businessesController');

// Public
router.get('/categories', asyncHandler(businessesController.listCategories));
router.get('/', asyncHandler(businessesController.list));
router.get('/trending', asyncHandler(businessesController.trending));
router.get('/:id', asyncHandler(businessesController.getById));

// Authenticated business routes
router.post('/scan-member', authenticate, asyncHandler(businessesController.scanMember));

// Auth required
router.post(
  '/register',
  authenticate,
  [
    body('name').trim().notEmpty(),
    body('category_id').notEmpty(),
    body('city').trim().notEmpty(),
  ],
  asyncHandler(businessesController.register)
);
router.patch('/my', authenticate, asyncHandler(businessesController.updateMy));
router.get('/my/profile', authenticate, asyncHandler(businessesController.getMy));
router.get('/my/analytics', authenticate, asyncHandler(businessesController.getAnalytics));

// Voting
router.post('/:id/vote', authenticate, asyncHandler(businessesController.vote));
router.get('/votes/results', asyncHandler(businessesController.voteResults));

module.exports = router;
