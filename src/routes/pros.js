const router = require('express').Router();
const { authenticate, optionalAuthenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const prosController = require('../controllers/prosController');

router.get('/', asyncHandler(prosController.list));
router.get('/founding-wall', asyncHandler(prosController.foundingWall));
router.get('/my', authenticate, asyncHandler(prosController.getMy));
router.post('/apply', authenticate, asyncHandler(prosController.apply));
router.get('/:id', optionalAuthenticate, asyncHandler(prosController.getById));

module.exports = router;
