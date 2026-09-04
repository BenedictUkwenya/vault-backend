const crypto = require('crypto');
const logger = require('../config/logger');

const APP_NAME = process.env.APP_NAME || 'Black Limitless';
const FROM = process.env.EMAIL_FROM || 'Black Limitless <hello@blacklimitless.com>';
const REPLY_TO = process.env.EMAIL_REPLY_TO || 'hello@blacklimitless.com';

let resendClient = null;

function getResend() {
  if (!process.env.RESEND_API_KEY) {
    throw new Error('RESEND_API_KEY is not configured');
  }
  if (!resendClient) {
    const { Resend } = require('resend');
    resendClient = new Resend(process.env.RESEND_API_KEY);
  }
  return resendClient;
}

function wrapHtml({ title, bodyHtml }) {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${title}</title>
</head>
<body style="margin:0;padding:0;background:#0a0a0a;font-family:Georgia,'Times New Roman',serif;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0a0a0a;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width:520px;background:#141414;border:1px solid rgba(212,175,55,0.35);border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 28px 12px;text-align:center;">
              <div style="font-size:11px;letter-spacing:0.28em;text-transform:uppercase;color:#d4af37;font-weight:700;">${APP_NAME}</div>
              <h1 style="margin:14px 0 0;font-size:22px;line-height:1.3;color:#f5f5f5;font-weight:700;">${title}</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 28px;color:rgba(255,255,255,0.78);font-size:15px;line-height:1.6;">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 28px;text-align:center;font-size:12px;color:rgba(255,255,255,0.4);">
              You’re receiving this because you have an account with ${APP_NAME}.
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function codeBlock(code) {
  return `<div style="margin:20px 0;text-align:center;">
    <div style="display:inline-block;padding:14px 22px;border-radius:12px;background:rgba(212,175,55,0.12);border:1px solid rgba(212,175,55,0.45);font-size:28px;letter-spacing:0.35em;font-weight:700;color:#d4af37;font-family:ui-monospace,Menlo,Consolas,monospace;">
      ${code}
    </div>
    <p style="margin:12px 0 0;font-size:13px;color:rgba(255,255,255,0.5);">This code expires in 15 minutes.</p>
  </div>`;
}

async function sendEmail({ to, subject, html, text }) {
  if (!to) throw new Error('Missing email recipient');
  try {
    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: FROM,
      to: [to],
      replyTo: REPLY_TO,
      subject,
      html,
      text: text || undefined,
    });
    if (error) {
      logger.error('Resend send failed', { to, subject, error });
      throw new Error(error.message || 'Failed to send email');
    }
    return data;
  } catch (err) {
    logger.error('emailService.sendEmail error', { to, subject, message: err.message });
    throw err;
  }
}

async function sendVerifyEmail(to, code) {
  const subject = `Verify your ${APP_NAME} email`;
  const html = wrapHtml({
    title: 'Verify your email',
    bodyHtml: `<p>Welcome — enter this code in the app to confirm your account:</p>${codeBlock(code)}<p>If you didn’t create an account, you can ignore this email.</p>`,
  });
  return sendEmail({
    to,
    subject,
    html,
    text: `Your ${APP_NAME} verification code is ${code}. It expires in 15 minutes.`,
  });
}

async function sendAdminStepUpEmail(to, code) {
  const subject = `${APP_NAME} admin verification code`;
  const html = wrapHtml({
    title: 'Admin verification',
    bodyHtml: `<p>Someone is trying to use admin tools in the ${APP_NAME} app. Enter this code to unlock admin actions:</p>${codeBlock(code)}<p>If this wasn’t you, change your password and contact support immediately.</p>`,
  });
  return sendEmail({
    to,
    subject,
    html,
    text: `Your ${APP_NAME} admin verification code is ${code}. It expires in 15 minutes. If this wasn’t you, secure your account.`,
  });
}

async function sendWelcomeEmail(to, fullName) {
  const name = fullName || 'there';
  const subject = `Welcome to ${APP_NAME}`;
  const html = wrapHtml({
    title: 'You’re in',
    bodyHtml: `<p>Hey ${name},</p>
      <p>Your email is verified and your membership is ready. Open the app to explore deals, and subscribe when you’re ready to unlock paid benefits.</p>
      <p style="margin-top:20px;color:#d4af37;">— The ${APP_NAME} team</p>`,
  });
  return sendEmail({
    to,
    subject,
    html,
    text: `Welcome to ${APP_NAME}, ${name}. Your email is verified — open the app to get started.`,
  });
}

async function sendPasswordResetCode(to, code) {
  const subject = `Your ${APP_NAME} password reset code`;
  const html = wrapHtml({
    title: 'Reset your password',
    bodyHtml: `<p>Use this code in the app to set a new password:</p>${codeBlock(code)}<p>If you didn’t request this, you can ignore this email.</p>`,
  });
  return sendEmail({
    to,
    subject,
    html,
    text: `Your ${APP_NAME} password reset code is ${code}. It expires in 15 minutes.`,
  });
}

async function sendPasswordChangedEmail(to) {
  const subject = `Your ${APP_NAME} password was changed`;
  const html = wrapHtml({
    title: 'Password updated',
    bodyHtml: `<p>Your password was changed successfully. If this wasn’t you, contact support right away.</p>`,
  });
  return sendEmail({
    to,
    subject,
    html,
    text: `Your ${APP_NAME} password was changed. If this wasn’t you, contact support.`,
  });
}

async function sendNotificationEmail(to, { title, body }) {
  const subject = `${APP_NAME}: ${title}`;
  const html = wrapHtml({
    title,
    bodyHtml: `<p>${body}</p><p style="margin-top:18px;font-size:13px;color:rgba(255,255,255,0.5);">Open the app to view details. You can turn off email notifications in Profile settings.</p>`,
  });
  return sendEmail({
    to,
    subject,
    html,
    text: `${title}\n\n${body}`,
  });
}

async function sendNetworkInviteEmail(to, { fullName, code }) {
  const name = fullName || 'there';
  const subject = `You’re invited to ${APP_NAME}`;
  const html = wrapHtml({
    title: 'Application approved',
    bodyHtml: `<p>Hey ${name},</p>
      <p>Your Network application was approved. Download the Black Limitless app, then use this code to set your password:</p>
      ${codeBlock(code)}
      <p>After you sign in, subscribe in the app to activate your preferred membership plan.</p>`,
  });
  return sendEmail({
    to,
    subject,
    html,
    text: `Your ${APP_NAME} application was approved. Set your password with code ${code} (expires in 15 minutes).`,
  });
}

async function sendApplicationReceivedEmail(to, fullName) {
  const name = fullName || 'there';
  const subject = `We received your ${APP_NAME} application`;
  const html = wrapHtml({
    title: 'Application received',
    bodyHtml: `<p>Hey ${name},</p>
      <p>Thanks for applying. Our team will review your application shortly. If approved, you’ll get an invite to set up the mobile app.</p>
      <p>Membership interest on the form is preference only — you pay for paid plans inside the app after approval.</p>`,
  });
  return sendEmail({
    to,
    subject,
    html,
    text: `Thanks ${name} — we received your ${APP_NAME} application and will review it soon.`,
  });
}

/** Generate a 6-digit numeric code */
function generateOtpCode() {
  return String(crypto.randomInt(100000, 999999));
}

function hashOtpCode(code) {
  return crypto.createHash('sha256').update(String(code).trim()).digest('hex');
}

module.exports = {
  sendEmail,
  sendVerifyEmail,
  sendAdminStepUpEmail,
  sendWelcomeEmail,
  sendPasswordResetCode,
  sendPasswordChangedEmail,
  sendNotificationEmail,
  sendNetworkInviteEmail,
  sendApplicationReceivedEmail,
  generateOtpCode,
  hashOtpCode,
  wrapHtml,
};
