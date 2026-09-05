const passportService = require('../services/passportService');

async function getMine(req, res) {
  try {
    const progress = await passportService.getProgress(req.user.id);
    const stamps = progress.stamps_count || 0;
    const available = progress.rewards_available || 0;
    const credits = progress.passport_redemption_credits || 0;
    res.json({
      ...progress,
      copy: {
        title: 'Your Passport',
        subtitle:
          stamps === 0
            ? 'Redeem a deal at a partner. When they verify it, you earn a stamp.'
            : 'Every verified visit earns a stamp. Fill the page to unlock a claimable reward.',
        note:
          available > 0
            ? `You have ${available} Passport reward${available === 1 ? '' : 's'} ready to claim.`
            : credits > 0
              ? `You have ${credits} bonus redemption credit${credits === 1 ? '' : 's'} banked for when you hit your monthly limit.`
              : 'Stamps save automatically. Every 5 verified visits unlocks a bonus deal redemption you can claim.',
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

async function claimReward(req, res) {
  try {
    const grantId = req.params.id;
    const result = await passportService.claimGrant(req.user.id, grantId);
    res.json(result);
  } catch (e) {
    const msg = e.message || 'Could not claim reward';
    const status = /not found/i.test(msg) ? 404 : /already claimed/i.test(msg) ? 409 : 400;
    res.status(status).json({ error: msg });
  }
}

module.exports = { getMine, claimReward };
