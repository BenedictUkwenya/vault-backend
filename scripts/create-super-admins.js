/**
 * Create super_admin portal accounts.
 *
 * Usage (from vault-backend):
 *   node scripts/create-super-admins.js
 *
 * Optional custom passwords:
 *   node scripts/create-super-admins.js "Pass1!" "Pass2!"
 *
 * Requires SUPABASE_URL and SUPABASE_SERVICE_KEY in .env
 */
require('dotenv').config();
const crypto = require('crypto');
const { createClient } = require('@supabase/supabase-js');

const EMAILS = [
  'blacklimitless888@gmail.com',
  'donakpovwa@gmail.com',
];

function randomPassword() {
  return `Vault!${crypto.randomBytes(9).toString('base64url')}`;
}

async function main() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in .env');
    process.exit(1);
  }

  const customPasswords = process.argv.slice(2);
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const results = [];

  for (let i = 0; i < EMAILS.length; i++) {
    const email = EMAILS[i];
    const password = customPasswords[i] || randomPassword();

    const { data: listData } = await supabase.auth.admin.listUsers();
    const existing = listData?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

    let userId = existing?.id;

    if (existing) {
      const { error: pwErr } = await supabase.auth.admin.updateUserById(existing.id, {
        password,
        email_confirm: true,
      });
      if (pwErr) {
        results.push({ email, ok: false, error: pwErr.message });
        continue;
      }
    } else {
      const { data, error } = await supabase.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: email.split('@')[0] },
      });
      if (error) {
        results.push({ email, ok: false, error: error.message });
        continue;
      }
      userId = data.user.id;
    }

    // Profile row is created by DB trigger; retry briefly
    for (let attempt = 0; attempt < 5; attempt++) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('id')
        .eq('id', userId)
        .maybeSingle();

      if (profile) break;
      await new Promise((r) => setTimeout(r, 500));
    }

    const { error: roleErr } = await supabase
      .from('profiles')
      .update({ role: 'super_admin', email })
      .eq('id', userId);

    if (roleErr) {
      results.push({ email, ok: false, error: roleErr.message });
      continue;
    }

    results.push({ email, ok: true, password, userId });
  }

  console.log('\n=== Super Admin Accounts ===\n');
  for (const r of results) {
    if (r.ok) {
      console.log(`Email:    ${r.email}`);
      console.log(`Password: ${r.password}`);
      console.log(`Role:     super_admin`);
      console.log(`Login:    http://localhost:3001/login\n`);
    } else {
      console.log(`FAILED: ${r.email}`);
      console.log(`Error:  ${r.error}\n`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
