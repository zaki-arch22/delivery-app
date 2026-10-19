# PROGRESS.md: where the work stands (read this first when resuming)

Rules: CLAUDE.md is the source of truth for decisions; this file tracks work only. Update it after every finished piece, commit, push.
Branch: `claude/optimistic-cannon-iw9rm9` (repo zaki-arch22/delivery-app). Resume: `git pull`, the SessionStart hook prepares the machine (or run `bash .claude/hooks/session-start.sh` with CLAUDE_CODE_REMOTE=true), then `bash scripts/test-all.sh` must be green before new work.

## Done
- Project imported from the claude.ai chat; all suites green (288 tests + 10 database rules).
- New working rules in CLAUDE.md section 2; START_PROMPT.md removed.
- Cloud setup: SessionStart hook (`.claude/hooks/session-start.sh`) installs PostGIS, starts PostgreSQL, installs packages, builds the test database. A recurring scheduled task re-wakes this session to continue (see CLAUDE.md section 5).

- Milestone "free map": decision recorded (CLAUDE.md section 5). Server: road distances from our own OSRM (`ROUTING_URL`), safe fallback to the estimate, `distance_estimated` in get_quote; 12 new tests (OSRM up / down / not answering) on a made-up grid; `deploy/osrm.md`. 300 tests green.

- Milestone "first screens": Expo Router shell, ar/fr/en with instant right-to-left, brand components, welcome, phone, code, first sender profile, temporary home, settings. 7 screen tests drive the real screens against the real backend. Android bundle builds. 307 tests green.

- Milestone "driver photos": `upload_document` (decode + redraw, private folder, limits), add_profile takes photo ids, staff `get_document` (audited) and photos in the staff console, database guards, driver sign-up screen (camera/gallery) also from Settings. 14 functional + 19 attack + staff/console/app tests. 346 tests + 12 database rules green.

- Milestone "sender path": MapLibre map (OpenFreeMap style, OSM credit), pin A/B picking with "My location", details + price + order, live order screen (raise, cancel, driver, code, map), my orders, rating, problem report; live connection wired into the app. 4 screen tests incl. a full order with a real driver through the API. 350 tests + 12 database rules green.

- Milestone "driver path": driver home (online switch + position, live offer with countdown, today's numbers), job screen (pickup, call, maps, picked up, code + cash check, can't deliver -> return), my deliveries, cash; fixed a real bug (the start screen stacked "home" twice). 3 driver screen tests. 353 tests + 12 database rules green.

## In progress
- (none)

## Next, in order (matches CLAUDE.md section 9)
1. Offline queue for driver job steps.
2. First real phone build + push (both need free owner accounts: Expo, Firebase).

## Exact next action
Offline queue: in mobile/src/core, a small persistent queue (secure store or file) for update_job_step calls; the job screen marks the step as done locally and the queue retries until the server answers (repeated steps are safe on the server). Test it by making the server unreachable in a screen test.

## Dev notes
- Screen tests: `test/screens.tsx` (helpers, all routes), `test/http.ts` (test HTTP client; jest-expo replaces fetch). `renderRouter` turns on fake clocks: `open()` switches back to real ones. Test DB access goes through `psql` (pg stalls in that environment). Use `await fireEvent...` (testing library v14 is async); `toHaveTextContent('x')` is an EXACT match, use a regex; NEVER put `findBy...` inside `act(...)` (act holds updates back: deadlock); prices use non-breaking spaces (match with \s).
- Visual check: `EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=http://localhost:3399 npx expo export --dev --platform web`, serve, screenshot with the global playwright (`$(npm root -g)/playwright`).

## Pending questions / owner actions (ask together at the end of a milestone)
- Optional, free: allow `download.geofabrik.de` and `tiles.openfreemap.org` in this cloud environment's network settings so maps and road data can be tested with real Algiers data.
