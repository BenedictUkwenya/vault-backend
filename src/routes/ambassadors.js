const router = require('express').Router();
const { authenticate, requireAmbassador } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const ambassadorsController = require('../controllers/ambassadorsController');

router.use(authenticate, requireAmbassador);

router.get('/dashboard', asyncHandler(ambassadorsController.getDashboard));
router.get('/campaigns', asyncHandler(ambassadorsController.getCampaigns));
router.get('/referrals', asyncHandler(ambassadorsController.getReferrals));
router.get('/rewards', asyncHandler(ambassadorsController.getRewards));
router.get('/payouts', asyncHandler(ambassadorsController.getPayouts));
router.get('/leaderboard', asyncHandler(ambassadorsController.getLeaderboard));

module.exports = router;
