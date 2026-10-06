#!/usr/bin/env node
// Confirms that a pushed commit is what production is serving, without the hosting dashboard.
// Usage: node scripts/verify-deploy.mjs [commit]   (defaults to the current git HEAD)
// Exit code 0 = the API and the site both serve the commit and the database answers.
import { execSync } from 'node:child_process';

const API = process.env.API_URL || 'https://sss-demo-backend.onrender.com';
const SITE = process.env.SITE_URL || 'https://sss-demo-frontend.onrender.com';
const expected = (process.argv[2] || execSync('git rev-parse HEAD').toString().trim()).slice(0, 7);
const deadline = Date.now() + 15 * 60 * 1000; // free-tier builds plus a cold start can take minutes

async function getJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(90_000) });
    return res.ok ? await res.json() : null;
  } catch {
    return null;
  }
}

let api = null;
let site = null;
while (Date.now() < deadline) {
  [api, site] = await Promise.all([getJson(`${API}/health`), getJson(`${SITE}/version.json?t=${Date.now()}`)]);
  if (api?.commit === expected && site?.commit === expected) break;
  console.log(`waiting for ${expected}: api=${api?.commit ?? 'no answer'} site=${site?.commit ?? 'no answer'}`);
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}

const ok = api?.commit === expected && site?.commit === expected && api?.database === 'ok';
console.log(JSON.stringify({ expected, api, site }, null, 2));
console.log(
  ok
    ? `VERIFIED: ${expected} is live on the API and the site; database ok; ${api.migrations?.applied} migrations applied (latest ${api.migrations?.latest}).`
    : `NOT VERIFIED: expected ${expected} on both, with the database ok.`
);
process.exit(ok ? 0 : 1);
