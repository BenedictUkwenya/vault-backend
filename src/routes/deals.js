const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate, requireBusiness } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const dealsController = require('../controllers/dealsController');

// Public — specific routes before /:id
router.get('/', asyncHandler(dealsController.list));
router.get('/week', asyncHandler(dealsController.dealsOfWeek));
router.get('/college', asyncHandler(dealsController.collegeDeals));
router.get(
  '/:id/my-redemption',
  authenticate,
  asyncHandler(dealsController.getMyRedemption)
);
router.get('/:id', asyncHandler(dealsController.getById));

// Auth required
router.post(
  '/:id/redeem',
  authenticate,
  asyncHandler(dealsController.redeem)
);
router.post('/verify-redemption', authenticate, asyncHandler(dealsController.verifyRedemption));

// Business portal — create/update/delete
router.post(
  '/',
  authenticate,
  requireBusiness,
  [
    body('title').trim().notEmpty(),
    body('discount_percentage').isInt({ min: 25 }),
  ],
  asyncHandler(dealsController.create)
);
router.patch(
  '/:id',
  authenticate,
  requireBusiness,
  asyncHandler(dealsController.update)
);
router.delete('/:id', authenticate, requireBusiness, asyncHandler(dealsController.remove));

module.exports = router;
