const router = require('express').Router();
const { body } = require('express-validator');
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const bookingsController = require('../controllers/bookingsController');

router.get('/', authenticate, asyncHandler(bookingsController.listForUser));
router.get('/business', authenticate, asyncHandler(bookingsController.listForBusiness));
router.get('/:id', authenticate, asyncHandler(bookingsController.getById));
router.post(
  '/',
  authenticate,
  [
    body('business_id').notEmpty(),
    body('preferred_date').isISO8601(),
    body('preferred_time').matches(/^\d{2}:\d{2}$/),
    body('service_requested').trim().notEmpty(),
  ],
  asyncHandler(bookingsController.create)
);
router.post('/:id/cancel', authenticate, asyncHandler(bookingsController.cancel));
router.post('/:id/approve', authenticate, asyncHandler(bookingsController.approve));
router.post('/:id/deny', authenticate, asyncHandler(bookingsController.deny));
router.post('/:id/complete', authenticate, asyncHandler(bookingsController.complete));

module.exports = router;
