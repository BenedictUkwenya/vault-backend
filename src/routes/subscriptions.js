const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const subscriptionsController = require('../controllers/subscriptionsController');

router.get('/status', authenticate, asyncHandler(subscriptionsController.getStatus));
router.post('/checkout', authenticate, asyncHandler(subscriptionsController.createCheckout));
router.post('/portal', authenticate, asyncHandler(subscriptionsController.createPortalSession));
router.post('/cancel', authenticate, asyncHandler(subscriptionsController.cancel));

module.exports = router;
