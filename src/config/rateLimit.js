const rateLimit = require('express-rate-limit');
const logger = require('./logger');

const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

let redis = null;
if (url && token) {
  const { Redis } = require('@upstash/redis');
  redis = new Redis({ url, token });
} else if (process.env.NODE_ENV === 'production') {
  logger.warn('Rate limiting is per-instance: set UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN to share limits');
}

// INCR + set the window expiry on first hit, in one round trip.
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

class UpstashStore {
  constructor(prefix, client) {
    this.client = client;
    this.prefix = `rl:${prefix}:`;
    this.localKeys = false;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  async increment(key) {
    const [hits, ttl] = await this.client.eval(INCREMENT_SCRIPT, [this.prefix + key], [String(this.windowMs)]);
    return { totalHits: Number(hits), resetTime: new Date(Date.now() + Number(ttl)) };
  }

  async decrement(key) {
    await this.client.decr(this.prefix + key);
  }

  async resetKey(key) {
    await this.client.del(this.prefix + key);
  }
}

/**
 * express-rate-limit with a Redis store shared by every serverless instance.
 * `name` must be unique per limiter so counters don't collide.
 */
function createLimiter(name, options) {
  return rateLimit({
    standardHeaders: true,
    legacyHeaders: false,
    ...options,
    ...(redis ? { store: new UpstashStore(name, redis), passOnStoreError: true } : {}),
  });
}

module.exports = { createLimiter, UpstashStore };
