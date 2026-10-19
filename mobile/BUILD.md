# Building the Android app (free)

The app is built in Expo's cloud ("EAS Build"): no Android computer setup is needed, and the free plan is enough to start.
Nothing here has been run yet: it needs the owner's free Expo account (and this cloud machine's network must allow Expo).

## One-time setup by the owner (about 10 minutes, free, no payment card)
1. Create an account at https://expo.dev/signup.
2. Create an access token: expo.dev → your avatar → Account settings → Access tokens → Create. Copy it.
3. In this Claude Code cloud environment's settings (environment menu → Edit):
   - add an environment variable `EXPO_TOKEN` = the token;
   - in Network access, allow `expo.dev`, `api.expo.dev`, `exp.host` and `storage.googleapis.com`.
Then Claude runs, from `mobile/`:
    npx eas-cli init --non-interactive          # creates the free Expo project, prints its id → saved as EXPO_PROJECT_ID
    npx eas-cli build -p android --profile preview --non-interactive
The result is an APK download link: install it on an Android phone to try the app.

## Before real users
- Set the real server address in `eas.json` (`EXPO_PUBLIC_API_URL`, HTTPS only).
- Phone push: create a free Firebase project, add an Android app with package `dz.delivery.app`, download `google-services.json`
  into `mobile/` (it is used automatically), and give the server its service-account key (`FIREBASE_SERVICE_ACCOUNT_JSON`).
- The package name `dz.delivery.app` is a placeholder: it must be final before the first Google Play upload (it can never change after).
