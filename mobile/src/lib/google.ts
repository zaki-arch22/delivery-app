import { GoogleSignin, isSuccessResponse, statusCodes } from '@react-native-google-signin/google-signin';
import { googleWebClientId } from './config';

// Opens Google's own account picker on the phone and returns Google's signed sign-in proof (an "ID token"), which the
// server checks. null = the person closed the picker. Free: no SMS, no fee.
export async function googleIdToken(): Promise<string | null> {
  GoogleSignin.configure({ webClientId: googleWebClientId() });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  await GoogleSignin.signOut().catch(() => {});   // always let the person pick the account (shared phones)
  try {
    const r = await GoogleSignin.signIn();
    return isSuccessResponse(r) ? r.data.idToken ?? null : null;
  } catch (e: any) {
    if (e?.code === statusCodes.SIGN_IN_CANCELLED || e?.code === statusCodes.IN_PROGRESS) return null;
    throw e;
  }
}
