const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const passportController = require('../controllers/passportController');

router.get('/me', authenticate, asyncHandler(passportController.getMine));

module.exports = router;
