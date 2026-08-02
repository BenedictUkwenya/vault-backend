const router = require('express').Router();
const { asyncHandler } = require('../middleware/errorHandler');
const mediaController = require('../controllers/mediaController');

router.get('/', asyncHandler(mediaController.listPublic));
router.get('/:id', asyncHandler(mediaController.getById));

module.exports = router;
