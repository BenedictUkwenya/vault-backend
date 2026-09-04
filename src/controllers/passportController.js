const passportService = require('../services/passportService');

async function getMine(req, res) {
  try {
    const progress = await passportService.getProgress(req.user.id);
    const stamps = progress.stamps_count || 0;
    res.json({
      ...progress,
      copy: {
        title: 'Your Passport',
        subtitle:
          stamps === 0
            ? 'Redeem a deal at a partner. When they verify it, you earn a stamp.'
            : 'Every verified visit earns a stamp. Fill the page to unlock a Passport reward.',
        note:
          progress.rewards_unlocked > 0
            ? `${progress.rewards_unlocked} reward${progress.rewards_unlocked === 1 ? '' : 's'} unlocked from exploring. Keep collecting — Passport perks keep growing.`
            : 'Stamps save automatically. Rewards unlock every 5 verified partner visits.',
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

module.exports = { getMine };
