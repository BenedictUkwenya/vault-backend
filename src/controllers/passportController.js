const passportService = require('../services/passportService');

async function getMine(req, res) {
  try {
    const progress = await passportService.getProgress(req.user.id);
    res.json({
      ...progress,
      copy: {
        title: 'Passport',
        subtitle: 'Collect stamps when partners verify your deals. Unlock rewards as you explore.',
        note: 'Passport rewards rollout continues — your stamps are saving now.',
      },
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

module.exports = { getMine };
