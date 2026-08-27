const router = require('express').Router();
const { optionalAuthenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const marketsController = require('../controllers/marketsController');

router.get('/', asyncHandler(marketsController.list));
router.get('/status', optionalAuthenticate, asyncHandler(marketsController.status));

module.exports = router;
