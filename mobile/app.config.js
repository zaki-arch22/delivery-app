// Adds what only exists once the owner's free accounts are set up, without breaking builds before that:
// - google-services.json (Firebase: phone push and Google sign-in on Android) is used only if the file is present;
// - the Expo project id links the app to the owner's free Expo account for cloud builds (in app.json, or EXPO_PROJECT_ID).
const fs = require('fs');
const firebase = fs.existsSync('./google-services.json');
module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, ...(firebase ? { googleServicesFile: './google-services.json' } : {}) },
  // Google sign-in reads the Firebase file; without it the button shows a calm error instead of breaking the build.
  plugins: [...(config.plugins ?? []), ...(firebase ? ['@react-native-google-signin/google-signin'] : []), './plugins/real-phones-only'],
  extra: { ...(config.extra ?? {}), ...(process.env.EXPO_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PROJECT_ID } } : {}) },
});
