const router = require('express').Router();
const { asyncHandler } = require('../middleware/errorHandler');
const paymentsController = require('../controllers/paymentsController');

// Stripe webhook — raw body middleware applied in index.js
router.post('/webhook', asyncHandler(paymentsController.webhook));

module.exports = router;
