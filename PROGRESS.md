# PROGRESS.md: where the work stands (read this first when resuming)

Rules: CLAUDE.md is the source of truth for decisions; this file tracks work only. Update it after every finished piece, commit, push.
Branch: `claude/wizardly-mayer-zl48ge` (continues `claude/optimistic-cannon-iw9rm9`) (repo zaki-arch22/delivery-app). Resume: `git pull`, the SessionStart hook prepares the machine (or run `bash .claude/hooks/session-start.sh` with CLAUDE_CODE_REMOTE=true), then `bash scripts/test-all.sh` must be green before new work.

## Done
- Project imported from the claude.ai chat; all suites green (288 tests + 10 database rules).
- New working rules in CLAUDE.md section 2; START_PROMPT.md removed.
- Cloud setup: SessionStart hook (`.claude/hooks/session-start.sh`) installs PostGIS, starts PostgreSQL, installs packages, builds the test database. A recurring scheduled task re-wakes this session to continue (see CLAUDE.md section 5).

- Milestone "free map": decision recorded (CLAUDE.md section 5). Server: road distances from our own OSRM (`ROUTING_URL`), safe fallback to the estimate, `distance_estimated` in get_quote; 12 new tests (OSRM up / down / not answering) on a made-up grid; `deploy/osrm.md`. 300 tests green.

- Milestone "first screens": Expo Router shell, ar/fr/en with instant right-to-left, brand components, welcome, phone, code, first sender profile, temporary home, settings. 7 screen tests drive the real screens against the real backend. Android bundle builds. 307 tests green.

- Milestone "driver photos": `upload_document` (decode + redraw, private folder, limits), add_profile takes photo ids, staff `get_document` (audited) and photos in the staff console, database guards, driver sign-up screen (camera/gallery) also from Settings. 14 functional + 19 attack + staff/console/app tests. 346 tests + 12 database rules green.

- Milestone "sender path": MapLibre map (OpenFreeMap style, OSM credit), pin A/B picking with "My location", details + price + order, live order screen (raise, cancel, driver, code, map), my orders, rating, problem report; live connection wired into the app. 4 screen tests incl. a full order with a real driver through the API. 350 tests + 12 database rules green.

- Milestone "driver path": driver home (online switch + position, live offer with countdown, today's numbers), job screen (pickup, call, maps, picked up, code + cash check, can't deliver -> return), my deliveries, cash; fixed a real bug (the start screen stacked "home" twice). 3 driver screen tests. 353 tests + 12 database rules green.

- Milestone "offline steps": job steps without network are saved on the phone and sent later (screen test with a simulated dead zone; refusal reported). 355 tests + 12 database rules green.

- Milestone "push and build prep": PushBridge (register_device for the active profile/language, tap opens the right screen), incoming parcels card for registered recipients, staff console shows problem reasons in words, eas.json + app.config.js + mobile/BUILD.md. 358 tests + 12 database rules green.

## In progress
- (none)

## Next, in order (matches CLAUDE.md section 9)
1. Owner actions (pending questions below), then: first Android build (APK) through Expo's cloud.
2. Before launch list (CLAUDE.md section 9).

## Exact next action
When `EXPO_TOKEN` is present and `api.expo.dev` is reachable (`curl -sS -o /dev/null -w "%{http_code}" https://api.expo.dev/`):
in `mobile/`: `npx eas-cli init --non-interactive`, save the printed project id as EXPO_PROJECT_ID (env var or app.config), then
`npx eas-cli build -p android --profile preview --non-interactive` and give the owner the APK link (plain steps to install it).
When `download.geofabrik.de` is reachable: build OSRM data for Algiers per backend/deploy/osrm.md into .local/osrm-algiers and test real road distances
(e.g. Place des Martyrs -> Bab Ezzouar) against expectations; check tiles.openfreemap.org style loads.
Until then: polish and review only; do not message the owner again.

## Dev notes
- Screen tests: `test/screens.tsx` (helpers, all routes), `test/http.ts` (test HTTP client; jest-expo replaces fetch). `renderRouter` turns on fake clocks: `open()` switches back to real ones. Test DB access goes through `psql` (pg stalls in that environment). Use `await fireEvent...` (testing library v14 is async); `toHaveTextContent('x')` is an EXACT match, use a regex; NEVER put `findBy...` inside `act(...)` (act holds updates back: deadlock); prices use non-breaking spaces (match with \s).
- Visual check: `EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=http://localhost:3399 npx expo export --dev --platform web`, serve, screenshot with the global playwright (`$(npm root -g)/playwright`).

## Owner answers (asked at the "push and build prep" milestone)
- Phone build: YES, the owner is creating the Expo account, EXPO_TOKEN and network allowance (expo.dev, api.expo.dev, exp.host, storage.googleapis.com). Settings reach NEW sessions.
- Firebase push: AFTER the first build (then guide the owner step by step).
- App name: not yet; keep the working name.
- Real map data: YES, allowing download.geofabrik.de and tiles.openfreemap.org.

## Pending questions / owner actions
- (2026-10-19) EXPO_TOKEN works and api.expo.dev is reachable, but the token's robot user "Claude" has the role **Viewer** on the Expo account `delivery_platform`, so `eas init` fails ("you can't create projects"). Owner: on expo.dev, account delivery_platform -> Settings -> Robot users (or Members) -> change "Claude" to **Developer** (free). Then retry the exact next action.
- download.geofabrik.de is still blocked (connection reset); tiles.openfreemap.org now answers 200.
