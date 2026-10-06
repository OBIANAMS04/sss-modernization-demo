#!/usr/bin/env node
// Confirms that production serves a pushed change, without the hosting dashboard.
// Usage (from sss-modernization-demo/): node scripts/verify-deploy.mjs [commit]   (default: git HEAD)
//
// Render rebuilds a service only when a push touches that service's root directory, so the API and
// the site can legitimately serve different commits. Each service is verified when the commit it
// serves (from /health and /version.json) includes the latest change to its own directory up to the
// target commit. Exit code 0 = both verified, the database answers, and every protected GET route
// in backend/src/security/routeAccess.ts refuses a request without a token on the live API.
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const API = process.env.API_URL || 'https://sss-demo-backend.onrender.com';
const SITE = process.env.SITE_URL || 'https://sss-demo-frontend.onrender.com';
const target = process.argv[2] || 'HEAD';
const deadline = Date.now() + 15 * 60 * 1000; // free-tier builds plus a cold start can take minutes

const git = (args) => execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
// ":/" makes the path relative to the repository root, wherever the script is run from.
const lastChange = (dir) => {
  const sha = git(`log -1 --format=%H ${target} -- ":/${dir}"`);
  if (!sha) throw new Error(`no commits touch ${dir} at ${target}`);
  return sha;
};
const required = {
  api: lastChange('sss-modernization-demo/backend'),
  site: lastChange('sss-modernization-demo/frontend'),
};

/** True when `served` (a short sha) is the required commit or a later one. */
function includes(served, requiredSha) {
  if (!served || served === 'local') return false;
  try {
    execSync(`git merge-base --is-ancestor ${requiredSha} ${git(`rev-parse ${served}`)}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false; // older commit, or not fetched locally
  }
}

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
let apiOk = false;
let siteOk = false;
while (Date.now() < deadline) {
  [api, site] = await Promise.all([getJson(`${API}/health`), getJson(`${SITE}/version.json?t=${Date.now()}`)]);
  apiOk = includes(api?.commit, required.api);
  siteOk = includes(site?.commit, required.site);
  if (apiOk && siteOk) break;
  console.log(
    `waiting: api serves ${api?.commit ?? 'no answer'} (needs ${required.api.slice(0, 7)}+), ` +
      `site serves ${site?.commit ?? 'no answer'} (needs ${required.site.slice(0, 7)}+)`
  );
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}

/**
 * Every protected GET route in the access table must answer 401 without a token. GET only, so a
 * missing guard is detected without anything on the live site being changed by the check itself
 * (routeAccess.test.ts covers every method before deploy).
 */
async function liveAccessSweep() {
  const table = readFileSync(new URL('../backend/src/security/routeAccess.ts', import.meta.url), 'utf8');
  const paths = [...table.matchAll(/'GET (\/[^']*)': '([a-z-]+)'/g)]
    .filter(([, , access]) => access !== 'public' && access !== 'optional-sign-in')
    .map(([, path]) => path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000000'));
  const open = [];
  for (const path of paths) {
    const res = await fetch(API + path, { signal: AbortSignal.timeout(30_000) }).catch(() => null);
    if (res?.status !== 401) open.push(`${path} -> ${res?.status ?? 'no answer'}`);
  }
  return { checked: paths.length, open };
}

const access = apiOk ? await liveAccessSweep() : null;
const ok = apiOk && siteOk && api?.database === 'ok' && access?.open.length === 0;
console.log(JSON.stringify({ target, required, api, site, access }, null, 2));
console.log(
  ok
    ? `VERIFIED: API serves ${api.commit} and site serves ${site.commit}, each including its latest change; database ok; ${api.migrations?.applied} migrations applied (latest ${api.migrations?.latest}); all ${access.checked} protected GET routes refuse requests without a token.`
    : 'NOT VERIFIED: see the served and required commits, and any open routes, above.'
);
process.exit(ok ? 0 : 1);
