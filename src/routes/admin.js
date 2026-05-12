const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const adminController = require('../controllers/adminController');

router.use(authenticate, requireAdmin);

router.get('/stats', asyncHandler(adminController.stats));
router.get('/users', asyncHandler(adminController.listUsers));
router.patch('/users/:id', asyncHandler(adminController.updateUser));
router.get('/businesses', asyncHandler(adminController.listBusinesses));
router.patch('/businesses/:id/approve', asyncHandler(adminController.approveBusiness));
router.patch('/businesses/:id/reject', asyncHandler(adminController.rejectBusiness));
router.get('/deals', asyncHandler(adminController.listDeals));
router.patch('/deals/:id/approve', asyncHandler(adminController.approveDeal));
router.delete('/deals/:id', asyncHandler(adminController.deleteDeal));
router.get('/subscriptions', asyncHandler(adminController.listSubscriptions));
router.post('/notifications/broadcast', asyncHandler(adminController.broadcastNotification));

module.exports = router;
