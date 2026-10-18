# Mobile app (React Native + Expo)

One app for Android and iPhone. Built with React Native and Expo (TypeScript), chosen over Flutter because it could be
type-checked and tested against the real backend in the build environment, and because Expo's free cloud builds make iPhone builds possible without a Mac.
Follow `AGENTS.md` (Expo's own guidance) for any Expo or React Native API.

## Built and tested so far: the foundation (src/core)
- storage.ts   the phone's secure vault (Android Keystore / iPhone Keychain); the long-lived login key never touches plain files and is not copied to backups or other phones
- api.ts       the only way the app talks to the server; renews an expired login automatically and sends exactly ONE renewal even when many requests notice at once (the server treats a reused renewal key as theft)
- session.ts   login by SMS code, first profile, second profile from Settings, switching, log out, log out of all devices, resuming after the app is reopened
- realtime.ts  live notifications: reconnects with growing delays, picks up exactly what was missed, never shows anything twice, renews an expired key itself

## Not built yet
The screens, push notifications (needs the Firebase key), maps, and driver document photos (needs the upload function on the server).

## Tests
From the project root: `bash scripts/test-all.sh` (type check + 7 tests against the real backend).

## Accepted build-tool risks
See `backend/docs/SECURITY.md`, section "Known, accepted risks".
