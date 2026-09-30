const logger = require('../config/logger');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const TIMEOUT_MS = 30 * 1000;

function isConfigured() {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function aiError(message, status = 502) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function chatCompletion(messages, { maxTokens = 600, temperature = 0.6 } = {}) {
  if (!isConfigured()) throw aiError('BL AI is not configured yet.', 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://www.blacklimitless.com',
        'X-Title': process.env.APP_NAME || 'Black Limitless',
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || DEFAULT_MODEL,
        messages,
        max_tokens: maxTokens,
        temperature,
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw aiError('BL AI took too long to respond. Please try again.', 504);
    logger.error({ message: 'OpenRouter request failed', error: err.message });
    throw aiError('BL AI is unavailable right now. Please try again shortly.');
  } finally {
    clearTimeout(timer);
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    logger.error({
      message: 'OpenRouter error response',
      status: response.status,
      error: data?.error?.message || null,
    });
    if (response.status === 429) throw aiError('BL AI is busy right now. Please try again in a moment.', 429);
    throw aiError('BL AI is unavailable right now. Please try again shortly.');
  }

  const reply = data?.choices?.[0]?.message?.content;
  if (typeof reply !== 'string' || !reply.trim()) {
    logger.error({ message: 'OpenRouter returned an empty reply', model: data?.model || null });
    throw aiError('BL AI could not come up with an answer. Please try rephrasing.');
  }

  return reply.trim();
}

module.exports = { isConfigured, chatCompletion, DEFAULT_MODEL };
