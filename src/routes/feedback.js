const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const feedbackController = require('../controllers/feedbackController');

router.post('/', authenticate, asyncHandler(feedbackController.submit));
router.get('/mine', authenticate, asyncHandler(feedbackController.mine));

module.exports = router;
