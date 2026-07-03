require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./config/logger');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const businessRoutes = require('./routes/businesses');
const dealRoutes = require('./routes/deals');
const bookingRoutes = require('./routes/bookings');
const subscriptionRoutes = require('./routes/subscriptions');
const referralRoutes = require('./routes/referrals');
const notificationRoutes = require('./routes/notifications');
const adminRoutes = require('./routes/admin');
const paymentRoutes = require('./routes/payments');
const ambassadorRoutes = require('./routes/ambassadors');
const waitlistRoutes = require('./routes/waitlist');
const feedbackRoutes = require('./routes/feedback');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Security ──────────────────────────────────────────────────────────────────
app.use(helmet());

const allowedOrigins = (process.env.ALLOWED_ORIGINS || process.env.FRONTEND_URL || '*')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.includes('*')) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS blocked for origin: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Raw body for Stripe webhooks (must be before express.json)
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '10mb' }));

// ── Logging ───────────────────────────────────────────────────────────────────
app.use(morgan('combined', {
  stream: { write: (msg) => logger.info(msg.trim()) },
}));

// ── Rate limiting ─────────────────────────────────────────────────────────────
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 min
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Too many auth attempts, please try again later.' },
});
app.use('/api/', limiter);
app.use('/api/auth/', authLimiter);

// ── Health ────────────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/businesses', businessRoutes);
app.use('/api/deals', dealRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/ambassadors', ambassadorRoutes);
app.use('/api/waitlist', waitlistRoutes);
app.use('/api/feedback', feedbackRoutes);

// ── 404 ───────────────────────────────────────────────────────────────────────
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// Only bind a port when run directly (local dev). Vercel imports this as a module.
if (require.main === module) {
  app.listen(PORT, () => {
    logger.info(`Vault backend running on port ${PORT} [${process.env.NODE_ENV}]`);
  });
}

module.exports = app;
