// Adds what only exists once the owner's free accounts are set up, without breaking builds before that:
// - google-services.json (Firebase, for phone push on Android) is used only if the file is present;
// - the Expo project id (EXPO_PROJECT_ID) links the app to the owner's free Expo account for cloud builds.
const fs = require('fs');
module.exports = ({ config }) => ({
  ...config,
  android: { ...config.android, ...(fs.existsSync('./google-services.json') ? { googleServicesFile: './google-services.json' } : {}) },
  extra: { ...(config.extra ?? {}), ...(process.env.EXPO_PROJECT_ID ? { eas: { projectId: process.env.EXPO_PROJECT_ID } } : {}) },
});
