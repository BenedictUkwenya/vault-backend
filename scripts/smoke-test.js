#!/usr/bin/env node
/** Quick smoke test for deployed backend */
const base = process.env.API_URL || 'https://vault-backend-rho.vercel.app';

async function check(path, expect = 200) {
  const res = await fetch(`${base}${path}`);
  const ok = res.status === expect || (expect === 'any' && res.status < 500);
  console.log(ok ? '✓' : '✗', path, res.status);
  return ok;
}

(async () => {
  let pass = 0;
  if (await check('/health')) pass++;
  if (await check('/api/businesses/categories')) pass++;
  if (await check('/api/deals')) pass++;
  console.log(`\n${pass}/3 checks passed`);
  process.exit(pass === 3 ? 0 : 1);
})();
