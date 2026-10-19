// Test stand-in for Google's account picker on the phone. It hands back a sign-in proof signed with the LOCAL test key
// (backend/test/google.ts), which the TEST server accepts; the real server only accepts Google's own keys.
import { googleToken } from '../../../backend/test/google';
export const googleMock = { sub: 'g-mobile-1', name: 'Test Person', cancel: false };
export const statusCodes = { SIGN_IN_CANCELLED: 'SIGN_IN_CANCELLED', IN_PROGRESS: 'IN_PROGRESS', PLAY_SERVICES_NOT_AVAILABLE: 'PLAY_SERVICES_NOT_AVAILABLE' };
export const isSuccessResponse = (r: any) => r?.type === 'success';
export const GoogleSignin = {
  configure() {},
  hasPlayServices: async () => true,
  signOut: async () => null,
  signIn: async () => googleMock.cancel ? { type: 'cancelled', data: null } : { type: 'success', data: { idToken: googleToken(googleMock.sub, { name: googleMock.name }), user: {} } },
};
