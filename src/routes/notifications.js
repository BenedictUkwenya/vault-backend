const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const notificationsController = require('../controllers/notificationsController');

router.get('/', authenticate, asyncHandler(notificationsController.list));
router.post('/:id/read', authenticate, asyncHandler(notificationsController.markRead));
router.post('/read-all', authenticate, asyncHandler(notificationsController.markAllRead));

module.exports = router;
