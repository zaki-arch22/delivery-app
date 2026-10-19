// Test stand-in for the phone's notification system (no phone in tests). A test sets `pushState.token` to act as a phone
// with Firebase set up, and calls `pushState.tap(data)` to act as a person tapping a notification.
type Fn = (x: any) => void;
export const pushState: { token: string | null; granted: boolean; tapListeners: Set<Fn>; tokenListeners: Set<Fn>; tap(data: any): void } = {
  token: null, granted: true, tapListeners: new Set(), tokenListeners: new Set(),
  tap(data: any) { this.tapListeners.forEach(f => f({ notification: { request: { content: { data } } } })); },
};
export const AndroidImportance = { HIGH: 4 };
export const getPermissionsAsync = async () => ({ granted: pushState.granted });
export const requestPermissionsAsync = async () => ({ granted: pushState.granted });
export const setNotificationChannelAsync = async () => null;
export const getDevicePushTokenAsync = async () => { if (!pushState.token) throw new Error('no Firebase in this build'); return { type: 'android', data: pushState.token }; };
export const setNotificationHandler = () => {};
export const addNotificationResponseReceivedListener = (f: Fn) => { pushState.tapListeners.add(f); return { remove: () => pushState.tapListeners.delete(f) }; };
export const addPushTokenListener = (f: Fn) => { pushState.tokenListeners.add(f); return { remove: () => pushState.tokenListeners.delete(f) }; };
