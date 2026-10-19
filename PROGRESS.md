# PROGRESS.md: where the work stands (read this first when resuming)

Rules: CLAUDE.md is the source of truth for decisions; this file tracks work only. Update it after every finished piece, commit, push.
Branch: `claude/optimistic-cannon-iw9rm9` (repo zaki-arch22/delivery-app). Resume: `git pull`, the SessionStart hook prepares the machine (or run `bash .claude/hooks/session-start.sh` with CLAUDE_CODE_REMOTE=true), then `bash scripts/test-all.sh` must be green before new work.

## Done
- Project imported from the claude.ai chat; all suites green (288 tests + 10 database rules).
- New working rules in CLAUDE.md section 2; START_PROMPT.md removed.
- Cloud setup: SessionStart hook (`.claude/hooks/session-start.sh`) installs PostGIS, starts PostgreSQL, installs packages, builds the test database. A recurring scheduled task re-wakes this session to continue (see CLAUDE.md section 5).

- Milestone "free map": decision recorded (CLAUDE.md section 5). Server: road distances from our own OSRM (`ROUTING_URL`), safe fallback to the estimate, `distance_estimated` in get_quote; 12 new tests (OSRM up / down / not answering) on a made-up grid; `deploy/osrm.md`. 300 tests green.

- Milestone "first screens": Expo Router shell, ar/fr/en with instant right-to-left, brand components, welcome, phone, code, first sender profile, temporary home, settings. 7 screen tests drive the real screens against the real backend. Android bundle builds. 307 tests green.

## In progress
- (none)

## Next, in order (matches CLAUDE.md section 9)
1. Photo upload server function (driver documents) + driver sign-up screen (photos, vehicle), and "add driver profile" in Settings.
2. User path (new order with map, price, searching, tracking, my orders, rating, problem).
3. Driver path (home online/offline, offer, active job, failure, earnings, cash).

## Exact next action
Design the upload function: read backend auth (add_profile driver docs) and staff list_pending_drivers; add `upload_document` (type/size checks, private storage outside the web folder, expiring signed links for staff), attack tests, then the driver sign-up screen with expo-image-picker.

## Dev notes
- Screen tests: `test/http.ts` is the test HTTP client (jest-expo replaces fetch). Use `await fireEvent...` (testing library v14 is async).
- Visual check: `EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=http://localhost:3399 npx expo export --dev --platform web`, serve, screenshot with the global playwright (`$(npm root -g)/playwright`).

## Pending questions / owner actions (ask together at the end of a milestone)
- Optional, free: allow `download.geofabrik.de` and `tiles.openfreemap.org` in this cloud environment's network settings so maps and road data can be tested with real Algiers data.
