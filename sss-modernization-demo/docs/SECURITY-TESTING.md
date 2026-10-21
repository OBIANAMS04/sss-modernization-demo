# Security testing and hardening (STORY-041)

Demonstrated on a synthetic demo deployment; not operating in production.

This is our own testing of the demo, run on a local copy of the deployed code. It is not a third-party penetration test, and it does
not replace one: production needs an independent test (and the agency's own assessment) before real data. Everything here can be
re-run: `node scripts/e2e/security.mjs` (52 checks; output in `docs/evidence/r3-m2-security-e2e.txt`).

## What the attack suite tries

| Area | Attempts | Result |
|---|---|---|
| Getting past sign-in | no token; garbage; `alg: none` with no signature; a payload changed to another person under the old signature; a signature from another key; the header switched to RS256; a two-step "pending" token used as a session | All refused (401) |
| Other people's records | a citizen reading and changing another person's profile, case and audit trail; another person's cases in a list | All refused (403 or 404); nothing leaks into lists |
| SQL injection | quotes, comments, `DROP TABLE`, wildcards, backslashes and template syntax in the case filters; injection in the sign-in form; objects in place of strings (`{"$ne": ""}`) | No server error and nothing extra returned; every query uses parameters |
| Script injection (XSS) | script and `onerror` markup stored in a profile | Stored as text, returned only as JSON with `nosniff`; React escapes it on the page; the site's content security policy would block injected script |
| Request bodies | a body over 100 kB; malformed JSON | 413 and 400 |
| Telling accounts apart | the time a wrong password takes for an account and for an address with no account | The same (about 0.3 s each; bcrypt runs either way) |
| Password guessing | 10 wrong passwords for one account; 30 failed sign-ins from one address across many accounts; 10 registrations from one address | Throttled with 429 and Retry-After (below) |
| Sign-out | the token, and an extended token of the same sign-in, after signing out | Refused (401 "Your session has ended") |
| Recovery codes | reuse, guessing, old codes after new ones are made | Each works once; guesses share the five tries of a sign-in; old codes stop working |
| Security headers and CORS | headers on a success, a refusal and the health check; a preflight and a read from another site | Headers on every response; another site gets no permission |

## Found and fixed

1. **A copied token kept working after sign-out (up to an hour).** Signing out now ends the session on the server: every token of
   one sign-in carries its session id (`sid`), extended tokens keep it, and sign-out records it (`revoked_sessions`, migration 027).
   The per-request role read checks the list in the same statement, so a refused token costs no extra database round trip.
2. **Unlimited password guessing.** Sign-in is throttled per account (10 tries in 15 minutes, counted before the password is checked;
   cleared only when the sign-in is complete, so a known password still leaves just five code guesses per sign-in) and per address
   (30 failures in 15 minutes); registration per address (10 an hour). Counters are in the database (`rate_limits`), so they hold
   across instances and restarts. A loopback caller has no address limits: on Render every caller's address comes from Cloudflare.
3. **Whether an address is registered could be told from response time.** A wrong password took about 0.3 s, an unknown address
   about 1 ms. An unknown address now runs the same bcrypt comparison against a fixed hash.
4. **No security headers on the API.** Every response now carries a content security policy that allows nothing, `nosniff`, frame
   denial, HSTS, no referrer, `no-store` and a permissions policy; the `X-Powered-By` banner is gone; the JSON body limit is stated
   (100 kB).
5. **Malformed or oversized bodies were 500s.** The body parser's refusals are now 400, 413 and 415, so they no longer hide among
   real faults.
6. **Objects in place of strings at sign-in were 500s** (found by the suite, in this story's own throttling code before it shipped).
   Sign-in now refuses anything but two strings of sensible length.
7. **No way back in after losing an authenticator.** Turning two-step verification on now gives ten one-time recovery codes (80
   random bits each, only a SHA-256 hash kept), shown once with copy and download; new ones can be made with a current code; using
   or making them is audited, the codes never are.
8. **No content security policy on the site.** The built site carries one (as a `<meta>` tag, because its host sets headers only in
   its dashboard): its own scripts and styles only, and connections only to its own API. The accessibility audit now fails on any
   policy violation on any page or role; it found none in the app (its own injected style was the only one, now applied another way).

## Dependencies

`npm audit --omit=dev` before and after:

| Package | Finding | Action |
|---|---|---|
| `tar` (critical, high) via bcrypt 5's install-time builder | Crafted archives can crash or loop the installer | bcrypt upgraded to 6.0.0, which ships prebuilt binaries and has no `tar`. Existing password hashes (`$2b$`, cost 12) verify unchanged |
| `uuid` (moderate) | Missing bounds check when a buffer is passed | Removed: the backend never imported it (Node's own `randomUUID` is used) |
| `axios`, `follow-redirects` (frontend, high) | Prototype pollution, header injection, redirect handling | Patched by `npm audit fix` |
| `sprintf-js` (moderate) via the OPA WebAssembly runtime | Denial of service through a format string with a huge precision | **Accepted.** It formats only strings written in our own policy, never request data; the only "fix" npm offers is a major downgrade of the OPA runtime. Revisit when OPA updates it |

## Accepted, and what production adds

- **Account lockout as denial of service.** Someone who knows an address can make its owner wait 15 minutes. This is the usual trade
  against unlimited guessing; every refusal is in the audit log. Production can add a CAPTCHA or a proof-of-work step after the
  first refusals instead of a hard lock.
- **Registration says when an address is already registered.** That is ordinary for sign-up and is slowed by the registration limit;
  production can move to "check your email" sign-up, which says nothing.
- **Framing protection for the site** (`frame-ancestors`, `X-Frame-Options`) works only as a response header, which this host sets in
  its dashboard (Render: the static site's Settings, Headers). The API already sends both. See the steps in the R3 milestone 2 post.
- **Tokens are kept in the browser's localStorage**, so script injected into the site could read them. The site's content security
  policy and React's escaping are the defences; production would use an HttpOnly, SameSite cookie with CSRF protection.
- **TOTP keys are stored readable** (they must be, to check codes); production encrypts them with a key from a key management service.
- **Not tested here:** the hosting platform, TLS configuration (Render and Cloudflare terminate TLS), denial of service at volume,
  social engineering, and the AI assistant's prompt injection beyond the grounding check (STORY-022) and the evaluation (STORY-020).
