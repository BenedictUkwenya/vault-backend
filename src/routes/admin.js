const router = require('express').Router();
const { authenticate, requireAdmin, requireAdminStepUp } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const adminController = require('../controllers/adminController');
const locationsController = require('../controllers/locationsController');

router.use(authenticate, requireAdmin);

// Step-up unlock (no action-token required)
router.post('/security/challenge', asyncHandler(adminController.securityChallenge));
router.post('/security/verify', asyncHandler(adminController.securityVerify));
router.get('/security/status', asyncHandler(adminController.securityStatus));
router.post('/security/logout', asyncHandler(adminController.securityLogout));

// Read-only admin views (login as admin is enough)
router.get('/stats', asyncHandler(adminController.stats));
router.get('/users', asyncHandler(adminController.listUsers));
router.get('/users/:id', asyncHandler(adminController.getUser));
router.get('/businesses', asyncHandler(adminController.listBusinesses));
router.get('/deals', asyncHandler(adminController.listDeals));
router.get('/locations', asyncHandler(locationsController.list));
router.get('/subscriptions', asyncHandler(adminController.listSubscriptions));

const mediaController = require('../controllers/mediaController');
router.get('/media', asyncHandler(mediaController.listAdmin));

// Mutations require email verification token
router.use(requireAdminStepUp);

router.patch('/users/:id', asyncHandler(adminController.updateUser));
router.post('/users/:id/notify', asyncHandler(adminController.notifyUser));
router.delete('/users/:id', asyncHandler(adminController.deleteUser));
router.patch('/businesses/:id/approve', asyncHandler(adminController.approveBusiness));
router.patch('/businesses/:id/reject', asyncHandler(adminController.rejectBusiness));
router.patch('/deals/:id/approve', asyncHandler(adminController.approveDeal));
router.patch('/deals/:id/reject', asyncHandler(adminController.rejectDeal));
router.delete('/deals/:id', asyncHandler(adminController.deleteDeal));
router.patch('/businesses/:id/featured', asyncHandler(adminController.toggleFeatured));
router.post('/locations', asyncHandler(locationsController.create));
router.patch('/locations/:id', asyncHandler(locationsController.update));
router.delete('/locations/:id', asyncHandler(locationsController.remove));
router.post('/notifications/broadcast', asyncHandler(adminController.broadcastNotification));
router.post('/media', asyncHandler(mediaController.create));
router.patch('/media/:id', asyncHandler(mediaController.update));
router.delete('/media/:id', asyncHandler(mediaController.remove));

module.exports = router;
