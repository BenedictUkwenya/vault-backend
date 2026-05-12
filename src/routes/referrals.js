const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const referralsController = require('../controllers/referralsController');

router.get('/stats', authenticate, asyncHandler(referralsController.getStats));
router.post('/apply', authenticate, asyncHandler(referralsController.applyCode));

module.exports = router;
