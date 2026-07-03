const router = require('express').Router();
const { body, query } = require('express-validator');
const { authenticate, requireBusiness } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const businessesController = require('../controllers/businessesController');

// Public
router.get('/categories', asyncHandler(businessesController.listCategories));
router.get('/', asyncHandler(businessesController.list));
router.get('/trending', asyncHandler(businessesController.trending));
router.get('/:id', asyncHandler(businessesController.getById));

// Authenticated business routes
router.post('/scan-member', authenticate, requireBusiness, asyncHandler(businessesController.scanMember));

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
router.patch('/my', authenticate, requireBusiness, asyncHandler(businessesController.updateMy));
router.get('/my/profile', authenticate, requireBusiness, asyncHandler(businessesController.getMy));
router.get('/my/analytics', authenticate, requireBusiness, asyncHandler(businessesController.getAnalytics));

// Voting
router.post('/:id/vote', authenticate, asyncHandler(businessesController.vote));
router.get('/votes/results', asyncHandler(businessesController.voteResults));
router.get('/votes/me', authenticate, asyncHandler(businessesController.myVote));

module.exports = router;
