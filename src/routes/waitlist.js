const router = require('express').Router();
const { asyncHandler } = require('../middleware/errorHandler');
const waitlistController = require('../controllers/waitlistController');

router.post('/', asyncHandler(waitlistController.join));

module.exports = router;
