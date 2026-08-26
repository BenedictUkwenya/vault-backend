const supabase = require('../config/supabase');
const emailService = require('./emailService');
const logger = require('../config/logger');

let expoClient = null;

function getExpo() {
  if (!expoClient) {
    const { Expo } = require('expo-server-sdk');
    expoClient = new Expo();
  }
  return expoClient;
}

async function sendPush(pushToken, { title, body, data }) {
  const { Expo } = require('expo-server-sdk');
  if (!pushToken || !Expo.isExpoPushToken(pushToken)) return;

  const expo = getExpo();

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

module.exports = { createNotification, createNotifications, sendPush };
