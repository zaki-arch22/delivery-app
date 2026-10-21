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

- Live work setup (2026-10-19, owner's wish: Windows laptop + Android phone): expo-dev-client, EAS profile `development` (build 8f1f018d-3dc3-479e-9264-03a0c9283082), guide mobile/LIVE_DEV.md.

- Trust phase 1 "proof chain" (2026-10-19, owner's wish, rules in backend/docs/TRUST_AND_SAFETY.md): server (pickup code + parcel photo + positions, refusal reasons with evidence, release_job, recall_order, receiver tracking page /t/<token> with map/ETA/code/QR, recipient_history, inspection) and app (QR scanner, Qr drawing, job screen, sender order screen with pickup QR, share link, photos, history, recall; details with inspection + receiver history). Fixed: tracking-page map pin error (seen in a real browser check). 457 tests + 12 database rules green.

- Trust phase 2 "rules engine" (2026-10-19): violations with points (automatic: driver gives back a job, late cancel, "never ordered" refusal; staff: far confirmation, wrong item, damage, behaviour, prohibited goods), levels (3 warning, 5 = 24 h, 8 = 7 days, 12 = until staff), blocks stop new work only, appeals (once, 30 days) decided by staff, staff blocks/lifts, bans (Google, device, national ID, verified phone cannot return), linked accounts by device, rules accepted at sign-up, national ID for drivers; app: Rules screen, My record with appeals; staff console: Rules page. Fixed: huge ids crashed queries. Development build with camera + device id: https://expo.dev/artifacts/eas/OIqHv3Prv_Gtc8Lbr-SPphRLhUtbvcW1TzkhU6VXTd0.apk. 512 tests + 12 database rules green.

- Trust phase 3 "safety nets" (2026-10-19): watchdog (silent driver 20 min, parcel overdue 3 h, pickup late 60 min: staff cases + "we are checking" to the sender), problem reports with categories + up to 3 photos within 24 h, emergency button (staff alert with position + 17/14/1055), weekly driver selfie before going online (staff compare with ID photo), order photos in the staff timeline. All tests green.

- Firebase project `delivery-c945c` created by the owner (2026-10-19): mobile/google-services.json saved, web client id 790230988811-20h827uvsigdi8dfcsdvq6oavmks6735.apps.googleusercontent.com in eas.json (= Render GOOGLE_CLIENT_IDS). The file has NO Android OAuth client (client_type 1): the SHA-1 fingerprint must still be added in Firebase (Project settings → Your apps → Android → Add fingerprint), otherwise Google sign-in on the phone fails (DEVELOPER_ERROR).

- Render server LIVE (2026-10-20): https://delivery-api-eu9h.onrender.com (staff console at /staff/). This cloud machine cannot reach onrender.com (proxy 403): checks must be done by the owner. eas.json preview/production point to it; EAS Update configured (channels development/preview/production, runtimeVersion appVersion). To ship a JS change WITHOUT a new APK: in mobile/, `EXPO_PUBLIC_API_URL=https://delivery-api-eu9h.onrender.com EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=790230988811-20h827uvsigdi8dfcsdvq6oavmks6735.apps.googleusercontent.com npx eas-cli@latest update --channel preview --environment preview --message "..." --non-interactive` (updates do NOT read the build profile env; afterwards `git checkout mobile/app.json`, the CLI rewrites it).

- Preview APK (2026-10-21, from commit 42630eb: dark inDrive design, all review fixes, live server, Google login, over-the-air updates): https://expo.dev/artifacts/eas/nbxBQaHarmkijtdzJzPvXLJDvlpiSJ3OgAtDgRB5c4E.apk . Older APKs show the old light design: build 6309a8d5 (made from the stale branch claude/optimistic-cannon-iw9rm9) lacks native modules the new code needs, so over-the-air updates fail on it and roll back. Never hand it out. An APK always starts on the code it was built with; an update replaces it only from the second launch.

- Milestone "inDrive-style app" (2026-10-20, owner's wish + reference pack of inDrive screenshots): SERVER: inDrive offers (request shown to up to 10 couriers, make_bid with the customer's price or more, accept_bid/decline_bid, auto-accept, 40 s offers, one pending offer per courier and locked price in range enforced by the database); place search + name under the pin through our server (Photon API, GEOCODER_URL; Render uses komoot's public Photon); road shape in quotes; ETA in get_order; list_notifications; rename_profile; app_config. APP: dark theme with lime main actions, Feather icons, map-first home with pickup pin + "Where to, and for how much?", destination with search, details with route + size cards + fare −/+ + auto-accept, order screen per state (waiting for the receiver with WhatsApp button, searching with raise, couriers' offer cards, courier card with time left), side menu (profile, parcels/deliveries, cash, notifications, safety, help, Customer/Courier mode button), courier home (online pill, numbers, requests list, accept or offer more, waiting countdown), job screen on the map, receiver page yes/no in the same dark look. Verified by screenshots in English and Arabic (web build with the map replaced). Fixed: a position check accepted "not a number" from query strings. 624 tests + 14 database rules green. Sent over the air to the preview APK (EAS Update group e6d0d6da-c9d4-48d1-b2f6-cddae1623e36, channel preview; the command now needs `--environment preview`; eas-cli rewrites mobile/app.json with duplicates: revert it).

- Milestone "fixes after the owner's review" (2026-10-20): bottom panels follow the finger (drag up/down, glide to open/folded, plain React Native); a finger on the map hides its pins and floating buttons until lifted; no language step at first launch (phone's language, change in Settings); distance in km on the route screen and the order screen; driver sign-up with first/last name, birth date, colour, plate, ID card, licence, ownership proof and 1-4 vehicle photos, never refused for quality (migration 017, staff console shows all of it); grey status-bar band #26282E on every screen (ui/Frame.tsx); receiver confirmation REMOVED on the owner's request (migration 018: orders search at once, track_confirm/track_decline gone, receiver page keeps "I am expecting it"). 620 tests + 14 database rules pass.

- Fixes after the owner's phone test (2026-10-21): map icons hide using the map's own move events (touch events alone never fired on the phone); bottom panels get a third, full-screen height (content scrolls only there); grey band 70% of the status bar; no "0 DA" lines when there is no price; staff console button fills the whole-Algiers zone. The owner's order was refused with "We do not deliver there yet": his zone does not cover those points or is not open (cannot be checked from here: onrender.com is blocked for this machine).

- Second phone round (2026-10-21): the owner tested 2 minutes after the previous update was published (not yet downloaded). Now: bottom panels float over a full-screen map on every screen, slide away while the map is touched, reach the top of the screen; "my location" rides above the panel; grey band = half the status bar. Checked in a browser with simulated finger drags (scratchpad vis2 scripts): drag up = full, drag down = normal, finger on map = only the map.

- Launch pieces (2026-10-21, owner's wish "all of Algeria + a distance limit", "notifications now", "everything missing for launch"): max_km per price table (default 50 km, TOO_FAR; console field; all-Algeria zone button), "Pick up here" button on the home map, address bubble over the centre pin, push sent on the app's high-importance channel with sound, "Delete my account" (server delete_account + attack tests SEC23 + Settings button + public /delete-account page), privacy policy page /privacy (3 languages, draft for legal review) linked from Settings, receiver page moved to MapLibre GL JS 6.13.0 (critical flaw in 5.x). 644 tests + 14 database rules pass. Owner's zone and prices were set by him on Render (2026-10-21).

- Photo upload fix (2026-10-21, owner's report "This photo could not be read"): the server's input guard refused photos that Android labels "application/octet-stream"; now any image type, that label or none is accepted and the content decides (attack test SEC16 kept: a declared web page/JSON is still refused). The app also sends the picture's JPEG bytes straight from the image tool.

## In progress
- (none)

## Next, in order (matches CLAUDE.md section 9)
1. Owner creates Neon + Firebase + Render (backend/deploy/render.md) and sends: the Render address + the content of google-services.json.
2. Then the new APK (server + Google login), first zone and prices in the staff console, phone push.
3. Before launch list (CLAUDE.md section 9).

## Exact next action
1. Wait for the owner's feedback on the "fixes after review" update (sent over the air to the preview APK). Fix what he reports first.
2. If place search does not work on the phone: check Render's GEOCODER_URL (render.yaml sets https://photon.komoot.io; a Blueprint that does not sync needs it added by hand in Environment).
3. Owner actions still open: SHA-1 fingerprint in Firebase (Google login), delete FIRST_ADMIN_RESET/PASSWORD on Render.
4. Then: phone push (Firebase service key into Render FIREBASE_SERVICE_ACCOUNT_JSON), TRUST_PROXY check, before-launch list (CLAUDE.md section 9: own Photon + OSRM server for Algiers).

## Dev notes
- Screen tests: `test/screens.tsx` (helpers, all routes), `test/http.ts` (test HTTP client; jest-expo replaces fetch). `renderRouter` turns on fake clocks: `open()` switches back to real ones. Test DB access goes through `psql` (pg stalls in that environment). Use `await fireEvent...` (testing library v14 is async); `toHaveTextContent('x')` is an EXACT match, use a regex; NEVER put `findBy...` inside `act(...)` (act holds updates back: deadlock); prices use non-breaking spaces (match with \s).
- Visual check (screenshots): a TEMPORARY mobile/metro.config.js that, when VISUAL_WEB=1, resolves `@maplibre/maplibre-react-native` to test/mocks/maplibre.tsx and `expo-secure-store` to test/mocks/securestore-web.js (getDefaultConfig + resolver.resolveRequest); run `VISUAL_WEB=1 EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://localhost:3399 npx expo start --web --port 8083` (the static `expo export --dev` reloads in a loop; CI=1 means no file watching: restart after edits), a small proxy on :3399 adding CORS in front of the test server, then the global playwright (`$(npm root -g)/playwright`, executablePath /opt/pw-browsers/chromium). Delete metro.config.js afterwards. Never `pkill -f` a pattern that is in your own command line (it kills the shell): kill by pid.
- Before an over-the-air update: `npx expo export --platform android` in mobile/ must build (checks fonts/icons resolve as on the phone).

## Owner answers (asked at the "push and build prep" milestone)
- Phone build: YES, the owner is creating the Expo account, EXPO_TOKEN and network allowance (expo.dev, api.expo.dev, exp.host, storage.googleapis.com). Settings reach NEW sessions.
- Firebase push: AFTER the first build (then guide the owner step by step).
- App name: not yet; keep the working name.
- Real map data: YES, allowing download.geofabrik.de and tiles.openfreemap.org.

## Pending questions / owner actions
- Owner: Firebase server key into Render (FIREBASE_SERVICE_ACCOUNT_JSON) = phone push notifications when the app is closed (steps sent 2026-10-21).
- Owner: a contact email for the privacy page and Google Play listing (the page says "Menu → Help" until then).
- Owner (money, later): Google Play developer account ($25 once) to publish; a lawyer's review of /privacy before launch (section 8).
- Owner: delete FIRST_ADMIN_RESET and FIRST_ADMIN_PASSWORD in Render Environment (if not done).
## Exact next action
1. Wait for the owner's phone test of: "Pick up here" button, address bubble over the pin, panels, too-far message, delete account. Fix what he reports first.
2. When the Firebase key is on Render: check the Render log has no "No push provider configured" line; send a test order and confirm a push arrives with the app closed.
3. Then the before-launch list (CLAUDE.md section 9): own Photon + OSRM for Algiers on a real server, traffic-flood filter, native-speaker text review, app name and logo, Play listing (privacy URL = <server>/privacy, deletion URL = <server>/delete-account).

## Dev notes
- Screen tests: `test/screens.tsx` (helpers, all routes), `test/http.ts` (test HTTP client; jest-expo replaces fetch). `renderRouter` turns on fake clocks: `open()` switches back to real ones. Test DB access goes through `psql` (pg stalls in that environment). Use `await fireEvent...` (testing library v14 is async); `toHaveTextContent('x')` is an EXACT match, use a regex; NEVER put `findBy...` inside `act(...)` (act holds updates back: deadlock); prices use non-breaking spaces (match with \s).
- Visual check (screenshots): a TEMPORARY mobile/metro.config.js that, when VISUAL_WEB=1, resolves `@maplibre/maplibre-react-native` to test/mocks/maplibre.tsx and `expo-secure-store` to test/mocks/securestore-web.js (getDefaultConfig + resolver.resolveRequest); run `VISUAL_WEB=1 EXPO_OFFLINE=1 CI=1 EXPO_PUBLIC_API_URL=http://localhost:3399 npx expo start --web --port 8083` (the static `expo export --dev` reloads in a loop; CI=1 means no file watching: restart after edits), a small proxy on :3399 adding CORS in front of the test server, then the global playwright (`$(npm root -g)/playwright`, executablePath /opt/pw-browsers/chromium). Delete metro.config.js afterwards. Never `pkill -f` a pattern that is in your own command line (it kills the shell): kill by pid.
- Before an over-the-air update: `npx expo export --platform android` in mobile/ must build (checks fonts/icons resolve as on the phone).

## Owner answers (asked at the "push and build prep" milestone)
- Phone build: YES, the owner is creating the Expo account, EXPO_TOKEN and network allowance (expo.dev, api.expo.dev, exp.host, storage.googleapis.com). Settings reach NEW sessions.
- Firebase push: AFTER the first build (then guide the owner step by step).
- App name: not yet; keep the working name.
- Real map data: YES, allowing download.geofabrik.de and tiles.openfreemap.org.

## Pending questions / owner actions
- Owner: add the SHA-1 fingerprint in Firebase (Google login on the phone fails without it).
- Owner: delete FIRST_ADMIN_RESET and FIRST_ADMIN_PASSWORD in Render Environment (if not done).
