# Security (all free tools)

## The honest promise
No system is unhackable. The goal is layers: an attacker has to defeat many independent barriers, every attempt leaves a trace, and a stolen secret never opens everything. Everything below is built, tested, and uses only free software.

## Layers that are built and tested (356 backend tests, 112 of them are attacks)
**Logins and sessions**
- Phone code: 6 digits, 5 guesses per code, counted by the database so even 25 simultaneous guesses get only 5; a code works once even if submitted 10 times at the same instant; codes are stored only as keyed hashes (a stolen database cannot reveal them).
- SMS fraud ("SMS pumping") cannot run up your bill: 5 codes/hour per phone, 20/hour per address, and a hard daily cap, all counted in the database.
- Access tokens last 15 minutes. Refresh tokens rotate on every use; if an OLD one is ever presented (a copy was stolen) the whole session is killed and logged.
- Tokens: algorithm pinned (blocks "alg none" and algorithm-swap), separate keys and audiences for app and staff tokens (key-confusion tested), each bound to one profile.
- Google login (free, no SMS): the server checks Google's signature, the expiry, the issuer and that the proof was made for OUR app (forged, expired, other-app, tampered, unsigned and unknown-key proofs are refused and logged). SMS login is switched off until an SMS provider exists. A phone number typed by a Google account is NOT verified: it is a contact number only (not unique, never used to find a person, never receives anyone's delivery code); a verified number can never be overwritten.
- At most 5 devices per account; a login on a second device alerts the account by push (stops silent SIM-swap takeovers); "log out everywhere" ends all sessions and live connections.
**Staff (the most valuable target)**
- Password AND a one-time authenticator code, both required. A code works once (shoulder-surfing and replay fail). The authenticator secret is stored encrypted. The answer for a wrong password and a wrong code is identical. 5 failures lock the account 15 minutes. Staff tokens last 2 hours and are killed by logout. Every staff action is saved forever (who, what, when).
**Requests**
- Security headers on every response; browsers from unknown websites get no cross-origin permission; JSON only; 64 KB body limit; prototype-pollution keys and array/object query tricks refused; slow-request timeouts; every id and field validated. A fuzz test sent malformed data to every user, driver and staff function: zero server errors.
- Rate limits: per address (300/min; 10/hour for login codes; 10 per 15 min for staff login), per logged-in session (120/min), per staff member.
- Live connection: 8 KB message limit, 5 connections per profile, 30 per address, message-flood cutoff, auth within 5 seconds.
**Data**
- All queries are parameterised (injection payloads are stored as harmless text). Everyone can only reach their own data (tested for orders, offers, jobs, ratings).
- The app connects to the database as a LIMITED role. Even if the app were fully taken over, the DATABASE refuses to: edit or delete cash entries, order history, ratings, the staff audit trail or the security log; change or add staff accounts; drop, alter or truncate tables; switch off its own rules. Verified by attacking the database as that role.
- Money rules live in the database itself (price lock, one job per driver, append-only ledger), not only in the app.
**Driver document photos**
- Only logged-in people can upload: a request without a login token is turned away before any of the photo is read (a token is fully checked right after). One route only, 6 MB maximum, 30 uploads per hour per address, 10 unused photos per account (unused ones are deleted after a day): storage cannot be filled. Photos are kept in the private database (table document_files), never in a web folder.
- The first bytes must say JPEG, PNG or WebP; then the photo is fully decoded and drawn again as a fresh JPEG (max 2000 px). Anything hidden inside or after it (scripts, archives, camera and GPS data) is thrown away. "Image bombs" (a tiny file claiming hundreds of millions of pixels) are refused.
- Photos are stored in the private database (never in a web folder), named by a random server id. Only staff can see them, through the API, and every view is written in the audit trail.
**Watching**
- A permanent security log records bad tokens, privilege probing, token theft, rate-limit hits, wrong codes, staff login failures, fraud caps. `npm run security-report` summarises the last 24 hours.
- Dependencies: `npm audit` reports 0 known vulnerabilities (the framework was upgraded to get there).
- Last-resort protections: a failed background task is logged and cannot crash the server.

## Bugs the attack tests found in my own work (all fixed)
0. (Oct 2026) A notification created while a phone was reconnecting could reach it twice; the free-host start found the limited role's password could not be refreshed by a non-superuser owner; the compiled server landed in the wrong folder.
1. A single oversized live-connection message **crashed the whole server** (an error event had no handler).
2. Simultaneous guesses could get past the 5-attempt limit (the check was not atomic); same race on one-time code use and refresh tokens.
3. The hashing pepper silently defaulted to empty; it is now required.
4. Malformed ids caused server errors instead of clean refusals.
5. 7 known vulnerabilities in libraries (2 high).

## What this does NOT cover (needs a person, or the server, or later work)
- **A human penetration test** before launch. Automated tests find what I think to test; a fresh pair of eyes finds what I didn't. Free community options exist (for example a responsible-disclosure page and a trusted security-minded friend).
- **The server itself**: use deploy/ (HTTPS with Caddy, a sandboxed service, firewall, automatic security updates, SSH keys only, PostgreSQL reachable only from the server, disk encryption, encrypted backups). These templates are written but NOT tested on a real server yet.
- **The free TEST server (Render + Neon, deploy/render.md)** is for testing with the owner and a few people, not for real customers: its settings page holds the database owner's address (the running server itself only gets the LIMITED role, the start script removes the owner's password before starting it), the first staff account's authenticator secret is printed once in the server log, and the address seen behind Render's proxy (TRUST_PROXY=1) must still be checked on the live server. Hosting location and data rules are parked (CLAUDE.md section 8).
- **Floods of traffic (DDoS)** need a filtering layer in front. A free plan from a major provider can do this; I have not set it up.
- **The mobile apps**: they must keep tokens in the phone's secure storage (not plain files), use HTTPS only (optionally pin the certificate), and can use Google's/Apple's free app-integrity checks. Built when the app is built.
- **Staff insiders**: every action is audited, but two-person approval for big cash changes needs a second staff member to exist.
- **Rate limits are held in memory** (one server). Running several servers needs them moved to a shared store.
- **Legal data protection duties** (registration, retention, hosting location) are parked with the rest of the legal work.

## Known, accepted risks (re-check before every release with `npm audit --omit=dev` in mobile/)
- `braces` (mobile bundler, on the BUILD machine only): denial-of-service with crafted file patterns, which only the people building the app control. No fixed version exists yet.
- `node-forge` (only signs over-the-air app updates): a signature-check weakness. That feature is deliberately NOT used; fix this first if it is ever turned on. No fixed version exists yet.
- `uuid` was vulnerable; it is forced to a patched version (mobile/package.json "overrides") and checked to work with the iPhone project tool.
- `sprintf-js` (moderate, no fixed version): reached only through the TEST tools (jest), which `npm audit --omit=dev` counts because the navigation library lists the testing library as an optional peer. Test machines only.
None of these run inside the app on customers' phones.

## Daily and monthly routine
- Daily: `npm run security-report`; look for "NEEDS ATTENTION".
- Weekly: `npm audit`; apply server updates (automatic security updates handle most).
- Monthly: test a backup restore; review who has staff access; remove people who left.
- If a secret leaks: change JWT_SECRET (everyone is logged out), HASH_PEPPER (everyone must request new codes), run `reset-2fa` for staff.
- If a phone is lost: the owner uses "log out everywhere"; staff use `reset-2fa`.
