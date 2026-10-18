// Where the app keeps its secrets. On a phone this is the system's secure vault (Android Keystore / iPhone Keychain):
// the long-lived login key never touches plain files, logs or the shared preferences.
export interface KeyStore { get(k: string): Promise<string | null>; set(k: string, v: string): Promise<void>; del(k: string): Promise<void> }

export function secureStore(): KeyStore {
  const S = require('expo-secure-store');
  const opts = { keychainAccessible: S.WHEN_UNLOCKED_THIS_DEVICE_ONLY };   // not copied to backups or to another phone
  return { get: k => S.getItemAsync(k, opts), set: (k, v) => S.setItemAsync(k, v, opts), del: k => S.deleteItemAsync(k, opts) };
}
export function memoryStore(): KeyStore {   // used only by tests
  const m = new Map<string, string>();
  return { get: async k => m.get(k) ?? null, set: async (k, v) => { m.set(k, v); }, del: async k => { m.delete(k); } };
}
