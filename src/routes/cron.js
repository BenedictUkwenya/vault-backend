const router = require('express').Router();
const supabase = require('../config/supabase');
const logger = require('../config/logger');
const { asyncHandler } = require('../middleware/errorHandler');
const notificationService = require('../services/notificationService');

const DAY = 24 * 60 * 60 * 1000;

function stageFor(expiresAt, now) {
  const left = new Date(expiresAt).getTime() - now;
  if (left <= 0) return 'expired';
  if (left <= 7 * DAY) return '7d';
  if (left <= 30 * DAY) return '30d';
  return null;
}

function copy(stage, label, days) {
  if (stage === 'expired') {
    return {
      title: 'Your credential has expired',
      body: `${label} is hidden from members until you renew. Request a new license check from your profile to go live again.`,
    };
  }
  return {
    title: stage === '7d' ? 'Credential expires this week' : 'Credential expires soon',
    body: `The license or permit on file for ${label} expires in ${days} day${days === 1 ? '' : 's'}. Renew it and request a new check so your listing stays live.`,
  };
}

/**
 * Daily job (Vercel cron). Warns owners 30 and 7 days before a credential expires, tells them when it has,
 * and marks the matching license check as expired. Each stage is sent once per expiry date.
 */
router.get(
  '/credential-expiry',
  asyncHandler(async (req, res) => {
    const secret = process.env.CRON_SECRET;
    if (!secret) return res.status(503).json({ error: 'CRON_SECRET is not configured.' });
    if (req.headers.authorization !== `Bearer ${secret}`) return res.status(401).json({ error: 'Unauthorized' });

    const now = Date.now();
    const horizon = new Date(now + 30 * DAY).toISOString();
    const sources = [
      { table: 'businesses', entityType: 'business', ownerCol: 'owner_id', nameCol: 'name' },
      { table: 'bl_pros', entityType: 'pro', ownerCol: 'user_id', nameCol: 'display_name' },
    ];
    const summary = { notified: 0, expired: 0, errors: 0 };

    for (const src of sources) {
      const { data, error } = await supabase
        .from(src.table)
        .select(`id, ${src.ownerCol}, ${src.nameCol}, credential_expires_at`)
        .not('credential_expires_at', 'is', null)
        .lte('credential_expires_at', horizon)
        .limit(500);
      if (error) {
        logger.warn({ message: 'credential expiry query failed', table: src.table, error: error.message });
        summary.errors += 1;
        continue;
      }

      for (const row of data || []) {
        const stage = stageFor(row.credential_expires_at, now);
        if (!stage) continue;
        const owner = row[src.ownerCol];
        if (!owner) continue;

        if (stage === 'expired') {
          await supabase
            .from('verification_checks')
            .update({ status: 'expired' })
            .eq('entity_type', src.entityType)
            .eq('entity_id', row.id)
            .eq('check_type', 'credential')
            .eq('status', 'completed');
          summary.expired += 1;
        }

        const marker = { entity_id: row.id, entity_type: src.entityType, stage, expires_at: row.credential_expires_at };
        const { data: sent } = await supabase
          .from('notifications')
          .select('id')
          .eq('user_id', owner)
          .eq('type', 'credential_expiry')
          .contains('data', marker)
          .limit(1);
        if (sent?.length) continue;

        const days = Math.max(1, Math.ceil((new Date(row.credential_expires_at).getTime() - now) / DAY));
        const { title, body } = copy(stage, row[src.nameCol] || 'your listing', days);
        try {
          await notificationService.createNotification({
            userId: owner,
            title,
            body,
            type: 'credential_expiry',
            data: marker,
          });
          summary.notified += 1;
        } catch (err) {
          summary.errors += 1;
          logger.warn({ message: 'credential expiry notify failed', error: err.message });
        }
      }
    }

    res.json(summary);
  })
);

module.exports = router;
