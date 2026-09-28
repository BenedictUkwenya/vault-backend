const supabase = require('../config/supabase');
const logger = require('../config/logger');

/** Best-effort audit trail; never fails the admin action itself. */
async function logAdminAction(req, { action, targetType, targetId, before = null, after = null }) {
  try {
    await supabase.from('admin_audit_log').insert({
      admin_id: req.user?.id || null,
      action,
      target_type: targetType,
      target_id: targetId ? String(targetId) : null,
      before,
      after,
      ip: req.ip || null,
    });
  } catch (err) {
    logger.warn('admin audit log failed', { action, message: err.message });
  }
}

module.exports = { logAdminAction };
