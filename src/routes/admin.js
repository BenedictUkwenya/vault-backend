const router = require('express').Router();
const { authenticate, requireAdmin } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const adminController = require('../controllers/adminController');
const locationsController = require('../controllers/locationsController');

router.use(authenticate, requireAdmin);

router.get('/stats', asyncHandler(adminController.stats));
router.get('/users', asyncHandler(adminController.listUsers));
router.patch('/users/:id', asyncHandler(adminController.updateUser));
router.get('/businesses', asyncHandler(adminController.listBusinesses));
router.patch('/businesses/:id/approve', asyncHandler(adminController.approveBusiness));
router.patch('/businesses/:id/reject', asyncHandler(adminController.rejectBusiness));
router.get('/deals', asyncHandler(adminController.listDeals));
router.patch('/deals/:id/approve', asyncHandler(adminController.approveDeal));
router.patch('/deals/:id/reject', asyncHandler(adminController.rejectDeal));
router.delete('/deals/:id', asyncHandler(adminController.deleteDeal));
router.patch('/businesses/:id/featured', asyncHandler(adminController.toggleFeatured));
router.get('/locations', asyncHandler(locationsController.list));
router.post('/locations', asyncHandler(locationsController.create));
router.patch('/locations/:id', asyncHandler(locationsController.update));
router.delete('/locations/:id', asyncHandler(locationsController.remove));
router.get('/subscriptions', asyncHandler(adminController.listSubscriptions));
router.post('/notifications/broadcast', asyncHandler(adminController.broadcastNotification));

module.exports = router;
