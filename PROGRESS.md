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

- Milestone "first Android build" (2026-10-19): Expo project @delivery_platform/mobile (id 85947c9a-3728-412f-939c-9cc15ab586c2, in app.json), robot role now Developer, build 0e2aaf5e-eedb-4fcf-89c7-39edd479b705 FINISHED: APK https://expo.dev/artifacts/eas/zcf33VsVJeK_S44Fus-Ix68z7U-5bhRjW-pfnomCT40.apk (keystore kept on Expo's servers). Points at a placeholder API (no server yet), so login cannot work. OpenFreeMap tiles verified for Algiers.

- Milestone "Google login + free test server" (2026-10-19, owner's choices): Google login on server and app (login_methods, login_google, set_phone; SMS login off), contact phone screen, name prefilled; render.yaml + render-start.sh (Neon-like database tested: non-superuser owner, restarts), staff console at /staff/, photos in the database; owner guide backend/deploy/render.md. Fixed 3 bugs (double notification on reconnect, limited-role password refresh on Neon, compiled server in the wrong folder). 400 tests + 12 database rules green.

## In progress
- (none)

## Next, in order (matches CLAUDE.md section 9)
1. Owner creates Neon + Firebase + Render (backend/deploy/render.md) and sends: the Render address + the content of google-services.json.
2. Then the new APK (server + Google login), first zone and prices in the staff console, phone push.
3. Before launch list (CLAUDE.md section 9).

## Exact next action
When the owner sends the Render address (https://....onrender.com) and google-services.json:
1. Save the file as mobile/google-services.json (not secret; commit it). Check it has an oauth_client with client_type 3 (web) and one with client_type 1 for dz.delivery.app with certificate_hash fb1552c2e61f2ef53785f15d63b5bfc725fe77b2.
2. In mobile/eas.json (preview + production env): EXPO_PUBLIC_API_URL = the Render address; EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = the client_type 3 client id (must equal the Render setting GOOGLE_CLIENT_IDS).
3. curl the address: /login_methods must say google:true (first call may take ~1 min while it wakes). Open /staff/ (page loads).
4. bash scripts/test-all.sh, commit, push, then `npx eas-cli@latest build -p android --profile preview --non-interactive --no-wait` in mobile/; send the APK link.
5. Guide the owner in the staff console: create the first zone (prepare a GeoJSON polygon of central Algiers for him to paste) and open it; set the first price version (the OWNER chooses the numbers: base, per km, extras, min/max %).
6. Check TRUST_PROXY=1 on Render: rate-limit addresses in security_events must be real client addresses.
OSRM real data: still blocked (download.geofabrik.de); not possible on Render free anyway.

## Dev notes
- Screen tests: `test/screens.tsx` (helpers, all routes), `test/http.ts` (test HTTP client; jest-expo replaces fetch). `renderRouter` turns on fake clocks: `open()` switches back to real ones. Test DB access goes through `psql` (pg stalls in that environment). Use `await fireEvent...` (testing library v14 is async); `toHaveTextContent('x')` is an EXACT match, use a regex; NEVER put `findBy...` inside `act(...)` (act holds updates back: deadlock); prices use non-breaking spaces (match with \s).
- Visual check: `EXPO_OFFLINE=1 EXPO_PUBLIC_API_URL=http://localhost:3399 npx expo export --dev --platform web`, serve, screenshot with the global playwright (`$(npm root -g)/playwright`).

## Owner answers (asked at the "push and build prep" milestone)
- Phone build: YES, the owner is creating the Expo account, EXPO_TOKEN and network allowance (expo.dev, api.expo.dev, exp.host, storage.googleapis.com). Settings reach NEW sessions.
- Firebase push: AFTER the first build (then guide the owner step by step).
- App name: not yet; keep the working name.
- Real map data: YES, allowing download.geofabrik.de and tiles.openfreemap.org.

## Pending questions / owner actions
- Owner: create Neon, Firebase, Render following backend/deploy/render.md; send the Render address and google-services.json.
- Later (when the server is up): the starting prices (base, per km, size and car extras, allowed range), set by the owner in the staff console.
