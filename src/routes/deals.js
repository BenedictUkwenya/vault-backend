const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const dealsController = require('../controllers/dealsController');

// Public
router.get('/', asyncHandler(dealsController.list));
router.get('/week', asyncHandler(dealsController.dealsOfWeek));
router.get('/college', asyncHandler(dealsController.collegeDeals));
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
  [
    body('title').trim().notEmpty(),
    body('discount_percentage').isInt({ min: 25 }),
  ],
  asyncHandler(dealsController.create)
);
router.patch(
  '/:id',
  authenticate,
  asyncHandler(dealsController.update)
);
router.delete('/:id', authenticate, asyncHandler(dealsController.remove));

module.exports = router;
