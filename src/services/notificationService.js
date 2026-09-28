const { Expo } = require('expo-server-sdk');
const supabase = require('../config/supabase');
const emailService = require('./emailService');
const logger = require('../config/logger');

const expo = new Expo();

async function sendPush(pushToken, { title, body, data }) {
  if (!pushToken || !Expo.isExpoPushToken(pushToken)) return;

  const messages = [
    {
      to: pushToken,
      sound: 'default',
      title,
      body,
      data: data || {},
    },
  ];

  const chunks = expo.chunkPushNotifications(messages);
  for (const chunk of chunks) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
    } catch (err) {
      logger.warn('Expo push failed', { message: err.message });
    }
  }
}

/**
 * Create in-app notification and fan out to push + email based on profile prefs.
 */
async function createNotification({
  userId,
  title,
  body,
  type = 'system',
  data = {},
}) {
  if (!userId || !title) return null;

  const { data: row, error } = await supabase
    .from('notifications')
    .insert({
      user_id: userId,
      title,
      body: body || '',
      type,
      data,
    })
    .select()
    .single();

  if (error) {
    logger.error('createNotification insert failed', { userId, error: error.message });
    throw new Error(error.message);
  }

  // Fan-out (never fail the main request)
  try {
    const { data: profile } = await supabase
      .from('profiles')
      .select('email, push_token, email_notifications, push_notifications')
      .eq('id', userId)
      .maybeSingle();

    if (!profile) return row;

    if (profile.push_notifications !== false && profile.push_token) {
      await sendPush(profile.push_token, { title, body, data: { type, ...data } });
    }

    if (profile.email_notifications !== false && profile.email) {
      try {
        await emailService.sendNotificationEmail(profile.email, { title, body });
      } catch (err) {
        logger.warn('notification email failed', { userId, message: err.message });
      }
    }
  } catch (err) {
    logger.warn('notification fan-out failed', { userId, message: err.message });
  }

  return row;
}

async function createNotifications(items) {
  if (!Array.isArray(items) || !items.length) return [];
  const results = [];
  for (const item of items) {
    try {
      const row = await createNotification(item);
      if (row) results.push(row);
    } catch (err) {
      logger.warn('createNotifications item failed', { message: err.message });
    }
  }
  return results;
}

/**
 * Bulk fan-out for broadcasts: one insert per chunk and batched Expo pushes,
 * so it finishes within a serverless request. Email is skipped on purpose.
 * Pass userIds to target specific users; otherwise every non-banned user.
 */
async function broadcast({ title, body, type = 'system', data = {}, userIds = null }) {
  const PAGE = 1000;
  let recipients = [];

  if (Array.isArray(userIds) && userIds.length) {
    for (let i = 0; i < userIds.length; i += PAGE) {
      const { data: rows } = await supabase
        .from('profiles')
        .select('id, push_token, push_notifications')
        .in('id', userIds.slice(i, i + PAGE))
        .eq('is_banned', false);
      recipients = recipients.concat(rows || []);
    }
  } else {
    for (let from = 0; ; from += PAGE) {
      const { data: rows, error } = await supabase
        .from('profiles')
        .select('id, push_token, push_notifications')
        .eq('is_banned', false)
        .order('id')
        .range(from, from + PAGE - 1);
      if (error) throw new Error(error.message);
      recipients = recipients.concat(rows || []);
      if (!rows || rows.length < PAGE) break;
    }
  }

  let inserted = 0;
  for (let i = 0; i < recipients.length; i += 500) {
    const chunk = recipients.slice(i, i + 500).map((r) => ({
      user_id: r.id,
      title,
      body: body || '',
      type,
      data,
    }));
    const { error } = await supabase.from('notifications').insert(chunk);
    if (error) logger.warn('broadcast insert chunk failed', { message: error.message });
    else inserted += chunk.length;
  }

  const messages = recipients
    .filter((r) => r.push_notifications !== false && r.push_token && Expo.isExpoPushToken(r.push_token))
    .map((r) => ({ to: r.push_token, sound: 'default', title, body, data: { type, ...data } }));
  let pushed = 0;
  for (const chunk of expo.chunkPushNotifications(messages)) {
    try {
      await expo.sendPushNotificationsAsync(chunk);
      pushed += chunk.length;
    } catch (err) {
      logger.warn('broadcast push chunk failed', { message: err.message });
    }
  }

  return { recipients: recipients.length, inserted, pushed };
}

module.exports = { createNotification, createNotifications, sendPush, broadcast };
