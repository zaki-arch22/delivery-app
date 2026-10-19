# Mobile app (React Native + Expo)

One app for Android and iPhone. Built with React Native and Expo (TypeScript), chosen over Flutter because it could be
type-checked and tested against the real backend in the build environment, and because Expo's free cloud builds make iPhone builds possible without a Mac.
Follow `AGENTS.md` (Expo's own guidance) for any Expo or React Native API.

## Built and tested so far: the foundation (src/core)
- storage.ts   the phone's secure vault (Android Keystore / iPhone Keychain); the long-lived login key never touches plain files and is not copied to backups or other phones
- api.ts       the only way the app talks to the server; renews an expired login automatically and sends exactly ONE renewal even when many requests notice at once (the server treats a reused renewal key as theft)
- session.ts   login by SMS code, first profile, second profile from Settings, switching, log out, log out of all devices, resuming after the app is reopened
- realtime.ts  live notifications: reconnects with growing delays, picks up exactly what was missed, never shows anything twice, renews an expired key itself

## Screens built and tested (src/app, Expo Router: every file there is a screen)
- welcome: language switch (Arabic right-to-left, French, English) and the two paths
- phone, code: SMS login (Algerian numbers typed any usual way; a new code only after 60 s; calm translated errors)
- new-profile: the first sender profile
- driver-signup: name, vehicle, the three document photos (camera or gallery, shrunk on the phone before sending), send for approval; also opened from Settings
- home: temporary landing screen (becomes "New order" / driver home)
- settings: language, switch or add the other profile, log out, log out of all devices
Shared pieces: `src/ui` (brand components, large buttons, never colour alone), `src/i18n` (all texts; the type check makes sure every language has every text), `src/lib` (login state, server address, error messages, phone numbers).
The server address is set when building: `EXPO_PUBLIC_API_URL=https://...` (release builds refuse anything but HTTPS).

## Not built yet
The order and driver work screens, the map, push notifications (needs the Firebase key).

## Tests
From the project root: `bash scripts/test-all.sh` (type check + 16 tests against the real backend: 7 for the foundation, 9 that drive the real screens like a person would (only the camera is replaced in tests)).

## Accepted build-tool risks
See `backend/docs/SECURITY.md`, section "Known, accepted risks".
