# Working live: Windows laptop + Android phone

How it works: the app's code lives on your laptop. Claude edits it there (Claude desktop app, "Code" tab).
Your phone runs a special **development version** of the app that loads the code from the laptop over Wi-Fi,
so every edit shows on the phone within 1–2 seconds. No reinstalling. All free.

## Once: on the phone (2 minutes)
1. Open the development-version link Claude sent you on the phone, download and install it
   (allow "install unknown apps" if asked). Its icon is the same app; it opens a "Development servers" screen.
2. Keep the phone on the **same Wi-Fi** as the laptop.

## Once: on the laptop (about 20 minutes, all free)
1. **Node.js**: https://nodejs.org → download the **LTS** version (22) → install with the default choices.
2. **Git**: https://git-scm.com/download/win → install with the default choices.
3. **Claude desktop app**: https://claude.ai/download → install → log in → open the **Code** tab.
4. In the Code tab, choose a folder (for example `Documents`) and ask Claude:
   "Clone zaki-arch22/delivery-app, switch to branch claude/wizardly-mayer-zl48ge, and start the mobile app live (mobile/LIVE_DEV.md)".
   Claude then runs, inside `mobile`: `npm ci` and `npx expo start` (with the server address from the step below).
5. When Windows asks whether Node.js may use the network, choose **Allow** (private networks).

## Every day
1. Open the Claude desktop app → Code tab → the delivery-app folder. Say "start the app live".
2. On the phone, open the app: it shows the laptop in "Development servers" (or scan the QR code shown on the laptop
   with the phone's camera). The app opens.
3. Ask Claude for changes. Each saved edit appears on the phone at once. Shake the phone for the developer menu (reload).
4. When happy, Claude commits and pushes to GitHub, so the cloud work and the laptop stay the same.

## Which server the live app uses
The live app talks to the free test server on Render (`backend/deploy/render.md`). On the laptop, Claude creates the file
`mobile/.env.local` with one line:  `EXPO_PUBLIC_API_URL=https://YOUR-SERVICE.onrender.com`
(and `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=...` for the Google button). This file is not uploaded to GitHub.

## If the phone cannot find the laptop
Some Wi-Fi networks (offices, cafés) block phones from reaching laptops. Then start with `npx expo start --tunnel`
(goes through the internet instead; a bit slower).

## Notes for Claude
- The development version is the EAS profile `development` (`expo-dev-client`), built in Expo's cloud; rebuild it only after
  native changes (new native libraries, app.json / app.config.js settings, google-services.json). Same signing key as the other
  builds, so the same SHA-1 is registered for Google sign-in.
- Before committing from the laptop: `npx tsc --noEmit` there; the full test suite (`bash scripts/test-all.sh`) runs in the
  cloud session (it needs PostgreSQL + PostGIS).
