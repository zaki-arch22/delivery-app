// Smaller APK: build the app's native engine only for the two processor types real Android phones use
// (arm64-v8a: almost every phone since about 2017; armeabi-v7a: older ones). The x86 copies only serve computer
// phone simulators. No effect on quality or speed. (Google Play app bundles are split per phone anyway.)
const { withGradleProperties } = require('expo/config-plugins');
const ABIS = 'armeabi-v7a,arm64-v8a';
module.exports = config => withGradleProperties(config, c => {
  c.modResults = c.modResults.filter(p => !(p.type === 'property' && p.key === 'reactNativeArchitectures'));
  c.modResults.push({ type: 'property', key: 'reactNativeArchitectures', value: ABIS });
  return c;
});
