const router = require('express').Router();
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const waitlistController = require('../controllers/waitlistController');

router.post('/', optionalAuthenticate, asyncHandler(waitlistController.join));
router.get('/my-status', authenticate, asyncHandler(waitlistController.myStatus));

module.exports = router;
