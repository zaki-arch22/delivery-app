# Mobile app (React Native + Expo)

One app for Android and iPhone. Built with React Native and Expo (TypeScript), chosen over Flutter because it could be
type-checked and tested against the real backend in the build environment, and because Expo's free cloud builds make iPhone builds possible without a Mac.
Follow `AGENTS.md` (Expo's own guidance) for any Expo or React Native API.

## Built and tested so far: the foundation (src/core)
- storage.ts   the phone's secure vault (Android Keystore / iPhone Keychain); the long-lived login key never touches plain files and is not copied to backups or other phones
- api.ts       the only way the app talks to the server; renews an expired login automatically and sends exactly ONE renewal even when many requests notice at once (the server treats a reused renewal key as theft)
- session.ts   login by SMS code, first profile, second profile from Settings, switching, log out, log out of all devices, resuming after the app is reopened
- realtime.ts  live notifications: reconnects with growing delays, picks up exactly what was missed, never shows anything twice, renews an expired key itself
- queue.ts     driver job steps made without network are saved on the phone (secure vault) and sent in order when the network is back; a step the server refuses is reported to the driver, never retried forever

## Screens built and tested (src/app, Expo Router: every file there is a screen)
- welcome: language switch (Arabic right-to-left, French, English) and the two paths
- phone, code: SMS login (Algerian numbers typed any usual way; a new code only after 60 s; calm translated errors)
- new-profile: the first sender profile
- driver-signup: name, vehicle, the three document photos (camera or gallery, shrunk on the phone before sending), send for approval; also opened from Settings
- home: sender: "Send a parcel", parcels in progress, my orders. Driver (src/ui/DriverHome.tsx): online switch, live offer with countdown (accept/decline), today's earnings, cash held and limit, rating
- job: the active delivery: go to pickup (call the sender, open in the phone's map app), picked up, delivery code + cash confirmation, can't deliver (return leg), rate the sender
- jobs, cash: my deliveries; cash held and every movement (collected, handed over with receipt number, corrections)
- new-order: pickup pin A then delivery pin B on the map (move the map under a fixed pin, or "My location")
- order-details: address details, recipient, size, who pays, cash on delivery, price (recommended, choose within the range in 10 DA steps), order
- order/[id]: searching (raise the offer), driver coming, on the way, delivered/failed/cancelled/expired; delivery code; map with the driver; cancel before pickup
- orders, rate/[id], problem/[id]: my orders (20 per page), rating, problem report
- settings: language, switch or add the other profile, log out, log out of all devices
Shared pieces: `src/ui` (brand components, large buttons, never colour alone), `src/i18n` (all texts; the type check makes sure every language has every text), `src/lib` (login state, server address, error messages, phone numbers).
The server address is set when building: `EXPO_PUBLIC_API_URL=https://...` (release builds refuse anything but HTTPS).

## Not built yet
Push notifications (needs the Firebase key). A real phone build has not been made yet (needs a free Expo account).

## Tests
From the project root: `bash scripts/test-all.sh` (type check + 25 tests against the real backend: 8 for the foundation, 17 that drive the real screens like a person would (only the camera, the GPS, the phone dialer and the map drawing are replaced in tests)).

## Accepted build-tool risks
See `backend/docs/SECURITY.md`, section "Known, accepted risks".
