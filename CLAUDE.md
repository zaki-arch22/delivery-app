# CLAUDE.md: Algiers parcel-delivery platform

This file is the single, current source of truth. Keep it that way: when a decision changes, EDIT the line (replace it), never append history.
Details live in one place each: the API in `backend/docs/API_CONTRACT_v1.md`, security in `backend/docs/SECURITY.md`, how to run tests in `scripts/`.

## 1. The project
A delivery marketplace for parcels and goods (NOT people) inside Algiers, scalable later to all of Algeria. In spirit like inDrive, but ORIGINAL: learn from successful apps, never copy their design or private technology.
Built so far by Claude in a claude.ai chat (October 2026), then moved to Claude Code. The original research documents stay in the owner's claude.ai project "delivery app"; they are background only, and this file overrides them.

## 2. The owner and how Claude works
**Roles.** The owner is not a developer; he gives opinions and wishes. Claude is the whole team (senior full-stack developer, UX/UI designer, security engineer, project manager) with full authority over every technical, design, product and ordering decision, and is responsible for the result.
**Work autonomously.** Never stop to ask permission, confirm a plan or announce what comes next: plan internally, then build. When something is unclear, choose the best option (CLAUDE.md, what successful delivery apps do, good engineering), record the decision and its reason here, and continue.
**Ask the owner ONLY for:** spending money; accounts or keys only he can create (SMS provider, Firebase, Google Play, Apple, server, maps) or anything needing his identity or payment; legal or financial rules (parked, section 8); the final app name; anything that could harm real users, real data or a live server, or that cannot be undone. Even then do not stop: write the question in `PROGRESS.md` ("Pending questions"), continue all work that does not depend on it, and ask all pending questions together in ONE multiple-choice message (AskUserQuestion) at the end of a milestone.
**Quality.** After every change run `bash scripts/test-all.sh` and fix any failure before moving on. Add tests for everything new (an attack test for every new server function). Never claim something works without running it; never invent facts, prices or results; no mock data.
**Save often.** Commit after each finished piece and push to GitHub. Keep `PROGRESS.md` current (done, pending, exact next action) so any new session can resume without repeating work.
**Report only at milestones** (a whole piece finished): a few lines of plain English: what is done, what works, what is next, pending questions. No step-by-step narration. Define any technical word used.
**Principles.** Simplicity: no feature, button or function that isn't needed or doesn't work; every screen maps to a backend function and back. Free tools first; say clearly when something costs money (he cannot pay yet). Technical work first; finance and law are parked. Keep this file the single current truth: replace outdated lines, never keep old versions; earlier technical decisions may be changed when a better way is found (record the new decision and why).

## 3. What exists (all tested)
| Part | Folder | Technology | Status |
|---|---|---|---|
| Backend | `backend/` | NestJS (TypeScript), PostgreSQL 16 + PostGIS, Node 22 | complete for the current scope; 317 tests incl. 92 attacks and 12 road-distance tests + 12 database-rule checks |
| Staff console | `staff-console/` | React 18 + Vite | complete; 13 tests against the real backend; matches the 23 staff functions one-to-one (incl. viewing driver photos) |
| Mobile app | `mobile/` | React Native + Expo SDK 58 (React Native 0.88), Expo Router | foundation (`src/core`) + welcome/language, phone login, profiles, driver sign-up with photos, settings, the whole SENDER path (map pins, details, price, searching, tracking, my orders, rating, problem) and the whole DRIVER path (online, offers, active job, return, cash, deliveries, steps saved offline), phone push wiring, incoming parcels for registered recipients; 28 tests against the real backend. Never built on a real phone yet |

- `bash scripts/dev-setup.sh` once (local test database), then `bash scripts/test-all.sh` runs everything (358 tests + 12 database rules). Run it after every change.
- The real database ships EMPTY: schema files only, no data.

## 4. Product decisions (current)
- **Coverage:** all of Algiers, with staff able to open or close zones (map polygons). New zones start closed. Why: over-expansion broke Borzo and Yassir France; zones let service quality decide.
- **Immediate orders only** (no scheduling).
- **One app, two paths.** The first screen asks "I want to send parcels" (User) or "I want to deliver" (Driver), with a language switch.
- **One phone number = one account with up to two INDEPENDENT profiles** (User, Driver). At login only the chosen path's profile is created; the second is added later only from Settings. Switching needs no new SMS. Each profile has its own data, ratings, status and notifications. Tokens are bound to one profile.
- **A driver profile never gets an order created by the same account** (stops fake deliveries, ratings and cash tricks).
- **Customers:** individuals and online sellers, equal focus, same app (no separate seller website).
- **Price:** the system recommends a price (base + per km + size/car extras, rounded up to 10 DA). The user may set any price inside a staff-set range (min %/max % of recommended), and may RAISE it while searching. Drivers accept or decline; no driver counter-offers (they slow matching). The price LOCKS when a driver accepts. Why: renegotiation after acceptance is inDrive's top complaint. Price rules are versioned; each order keeps its version.
- **Vehicle:** decided by parcel size (small/medium → motorbike, large → car). The user never picks.
- **Matching:** automatic, one driver at a time, nearest eligible first, offer expires after 20 s, radius 3 km widening to 8 km after 60 s, order expires after 10 min. These are starting values (`backend/src/common/config.ts`), to be tuned with real data. A driver holds one job at a time.
- **Delivery proof:** a 4-digit delivery code. The sender sees it in the app and gives it to the recipient; a recipient who is a registered user also gets it by push. After 5 wrong codes the order locks; staff can unlock it. Staff can never see the code.
- **Cash on delivery:** a permanent cash ledger per driver (never edited; corrections are new entries; a reversal works once). It records only the goods money (COD). Staff record handovers with numbered receipts. Each driver has a cash limit set at approval (0 = no COD orders); drivers over their limit get no COD offers.
- **Failed delivery** (no answer / refused / wrong address): a return leg back to the sender starts automatically, plus a problem report for staff. Cancelling is allowed only before pickup.
- **Ratings:** 1–5 stars plus an optional comment, both directions, once per order. Everyone sees star averages; only staff read comments.
- **Notifications:** push only (live WebSocket + phone push). Atomic: written in the same database transaction as the event. Missed ones replay on reconnect, never twice, one profile only. **No SMS except the login verification code. No email** at launch.
- **Languages:** Arabic (right-to-left), French, English everywhere, including push texts (wording must be reviewed by native speakers).
- **No mock data**, anywhere. Every list has an empty state.
- **Excluded:** food, groceries, warehousing, inter-wilaya network, international, dangerous or high-value goods.
- **Removed to keep it simple** (the owner may bring any back): scheduled delivery, seller website / CSV import / labels / seller API, saved addresses, in-app chat, recipient web page, choosing a vehicle, email.

## 5. Technical decisions
- One well-organised backend (a "modular monolith"), not microservices; no Kubernetes. Redis is NOT used yet (rate limits are in memory, live events use PostgreSQL LISTEN/NOTIFY); add it only when running several servers.
- Money is whole dinars (integers). Rules that protect money live in the database itself (price lock, one job per driver, append-only ledger and history).
- **Maps: free, open, no key, no payment card** (decided). Why: Google Maps needs a billing account with a card; open tools give the same features for a delivery app at no cost and with no lock-in.
  - *Map display in the app:* MapLibre React Native (open source) with vector tiles from OpenFreeMap's public service (free, no key, no registration, no stated view limits; OpenStreetMap data). The tile style address is a setting, never hard-coded, so we can switch to self-hosted tiles if needed. The OpenStreetMap Foundation's own tile server is NOT used (its policy forbids heavy app use). Credit "© OpenStreetMap contributors" must be shown on the map. MapLibre needs an Expo development build (not Expo Go); Expo's free cloud build covers that.
  - *Road distance and time:* our own OSRM server (open source) on the API server, using OpenStreetMap roads for the Algiers area (`backend/deploy/osrm.md`). All routing goes through ONE class (`backend/src/geo/routing.ts`, setting `ROUTING_URL`). If OSRM is off, slow (>1.5 s) or finds no road, the quote falls back to the straight-line estimate ×1.3 at 20 km/h and says `distance_estimated: true`. The public OSRM demo server is not used (non-commercial only).
  - *Addresses:* no address-search service. The person moves the map under a fixed centre pin (or uses "my location") and types street, building, floor and a landmark. Why: free, works with Algiers' informal addresses (landmarks matter more than street numbers), and the free OpenStreetMap search service forbids app-scale use.
  - *Not yet verified on real data:* this cloud machine's network blocks `download.geofabrik.de` (OpenStreetMap data) and `tiles.openfreemap.org`; OSRM is tested on a made-up test grid only.
- Push: Firebase Cloud Messaging (free) for Android and iPhone; wired on the server and in the app (the app registers the phone's token for the active profile and language), never tested with a real Firebase key. While the app is open, push banners are silenced (the live connection already shows the event). Builds: Expo's free cloud build (`mobile/eas.json`, `mobile/BUILD.md`); Android package `dz.delivery.app` is a placeholder that must be final before the first Google Play upload.
- SMS provider: not chosen (stub in `backend/src/auth/sms.service.ts`). Each login code costs money; get a real price quote before choosing.
- Mobile: React Native + Expo, chosen over Flutter (Flutter could not be built or tested in the original environment; Expo's free cloud builds iPhone apps without a Mac). Follow `mobile/AGENTS.md` for Expo APIs.
- **Cloud work setup:** the project runs in a Claude Code cloud session (works with the owner's laptop off). `.claude/hooks/session-start.sh` prepares any fresh machine (PostGIS, PostgreSQL, packages, test database). A scheduled task "Resume delivery-app work" wakes the session every 2 hours to continue from `PROGRESS.md` (so work restarts after usage limits reset). Limit: it only wakes THIS session; if the session is archived or deleted, the owner starts a new session on this repo and says "continue from PROGRESS.md".
- **Mobile structure:** Expo Router (screens in `mobile/src/app`), own small translation module (`src/i18n`, no extra library). Direction (right-to-left for Arabic) is applied by the app itself on every screen, and the phone's own RTL switching is turned off (`supportsRTL: false`), so changing language works instantly without restarting the app. Only the 3 Cairo weights used are bundled. `react-native-web` is a test tool only (screenshots for design checks), not a product.
- **Driver document photos:** uploaded one by one (`upload_document`, raw image body, max 6 MB), decoded and redrawn by the server (sharp) so hidden data is dropped, stored in a private folder (`UPLOAD_DIR`, not in the database, not in a web folder). Staff see them only through `get_document` with their login, every view audited; no shareable links (safer than the expiring links first planned: nothing to leak in logs or chats). Unused photos are deleted after a day. The phone shrinks photos to 2000 px before sending (less mobile data).
- **Sender order flow (UX):** two map steps (pin A, then pin B) then one details screen; price shown as recommended with −/+ 10 DA inside the allowed range; the order screen follows the order live (notifications) and checks every 4 s while active; raise the offer by +50/+100 DA while searching; cancel only before pickup; the delivery code is shown large. One idempotency key per order screen, so a retry never makes two orders. If the price expired, it is recalculated and the person confirms again.
- **Driver work (UX):** one online switch; while online the phone sends its position (foreground only: every 15 s or 25 m; the app stays open while working, no background location for now: simpler, and Google Play's background-location review is avoided). Offers arrive live, with a 5 s check as fallback; the offer card shows price, distances, cash to collect (amber + icon), sender rating, seconds left. The job screen gives one action at a time; calls and turn-by-turn navigation use the phone's own dialer and map app (free). Cash to collect must be confirmed before "delivered". The driver rates the sender after a delivery (returns are not rated). Without network, "picked up" and "delivered" are saved on the phone and sent automatically later (the driver can continue); a delivery code is then checked by the server only when it arrives, and a refusal is shown to the driver.
- **Working app name** until the owner chooses: "Delivery" / "Livraison" / "توصيل".
- Publishing: Android first (Google Play is $25 one-time, or a direct APK). iPhone is built but published later (Apple $99/year).

## 6. Security (must stay true; full list in `backend/docs/SECURITY.md`)
- Free tools only. Honest goal: many layers, a trace for every attempt, no single secret opens everything. Nothing is "unhackable".
- The app connects to the database as the LIMITED role `delivery_app` (cannot edit history, ledger, audit, staff accounts or the schema).
- Staff login: password + authenticator code (2FA), lockout, 2-hour tokens, permanent audit trail.
- Rotating refresh tokens with theft detection; 15-min access tokens; max 5 devices; new-login alerts; "log out everywhere".
- Rate limits, SMS-fraud caps, strict input checks, security headers, a permanent security log.
- Test hooks exist only with `TEST_HOOKS=1`; a production server refuses to start with it. Tests refuse to run on a database named `delivery`.
- Mobile keeps the login key in the phone's secure vault and sends exactly ONE token renewal at a time.
- Add a new attack test whenever you add an endpoint. Run `npm audit --omit=dev` in each project before releases.

## 7. Brand (direction A, chosen by the owner)
Deep blue `#1E40AF` (main), navy `#0B2A6B` (dark), pale blue `#E8EEFB` (soft backgrounds), amber `#F59E0B` (warnings and key alerts ONLY), page `#F6F8FC`, text `#0B1530`. Font: Cairo (covers Arabic and Latin). Clean, calm, large buttons. Never rely on colour alone. App name and logo: NOT chosen yet.

## 8. Parked (do not build until the owner reopens it)
Legal status of the platform and drivers, data-protection registration (ANPDP), hosting location, insurance, and all money rules beyond COD goods money: delivery-fee accounting, commission, driver payouts, merchant remittances, cancellation, waiting and return fees (returns are priced 0 for now).

## 9. Next steps, in order
Order (Claude's decision): each server piece is built right before the screen that uses it.
1. **First real phone build** (Android, Expo's free cloud build; needs the owner's free Expo account) and phone push (needs the owner's free Firebase project).
2. Before launch: real SMS provider, real server (test `backend/deploy/`, including OSRM with real Algiers roads and the photo folder), a traffic-flood filter, a human security test, native-speaker review of texts, app name and logo.

## 10. Accounts the owner does not have yet
SMS provider, Firebase project (free), Google Play ($25 once) / Apple ($99 per year) developer accounts, a server. (No map key is needed.) Build without them. When one is needed, explain how to get it step by step and what it costs.
