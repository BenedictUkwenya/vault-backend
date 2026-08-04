const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate, requireBusiness } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const businessesController = require('../controllers/businessesController');
const availabilityController = require('../controllers/availabilityController');

// Public / list
router.get('/categories', asyncHandler(businessesController.listCategories));
router.get('/', asyncHandler(businessesController.list));
router.get('/trending', asyncHandler(businessesController.trending));
router.get('/founding-wall', asyncHandler(businessesController.foundingWall));
router.get('/votes/results', asyncHandler(businessesController.voteResults));
router.get('/votes/me', authenticate, asyncHandler(businessesController.myVote));

// Owner "my" routes — must be before /:id
router.patch('/my', authenticate, requireBusiness, asyncHandler(businessesController.updateMy));
router.get('/my/profile', authenticate, requireBusiness, asyncHandler(businessesController.getMy));
router.get('/my/analytics', authenticate, requireBusiness, asyncHandler(businessesController.getAnalytics));
router.get('/my/availability', authenticate, requireBusiness, asyncHandler(availabilityController.getMyAvailability));
router.put('/my/availability', authenticate, requireBusiness, asyncHandler(availabilityController.putMyAvailability));
router.post('/my/availability/blocks', authenticate, requireBusiness, asyncHandler(availabilityController.addBlock));
router.delete(
  '/my/availability/blocks/:date',
  authenticate,
  requireBusiness,
  asyncHandler(availabilityController.removeBlock)
);

router.post('/scan-member', authenticate, requireBusiness, asyncHandler(businessesController.scanMember));
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

// Public by id
router.get('/:id/availability', asyncHandler(availabilityController.getPublicAvailability));
router.get('/:id', asyncHandler(businessesController.getById));
router.post('/:id/view', asyncHandler(businessesController.recordView));
router.get('/:id/rating/me', authenticate, asyncHandler(businessesController.myBusinessRating));
router.post(
  '/:id/rate',
  authenticate,
  [body('rating').isInt({ min: 1, max: 5 })],
  asyncHandler(businessesController.rateBusiness)
);
router.post('/:id/vote', authenticate, asyncHandler(businessesController.vote));

module.exports = router;
