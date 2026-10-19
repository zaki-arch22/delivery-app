import { Injectable } from '@nestjs/common';
import { OAuth2Client } from 'google-auth-library';

// Checks a Google sign-in proof (an "ID token" signed by Google) sent by the app. Free: no Google fee, no SMS.
// Accepted only if Google signed it, it is not expired, and it was issued for OUR app (GOOGLE_CLIENT_IDS).
const ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];
export const googleClientIds = () => (process.env.GOOGLE_CLIENT_IDS ?? '').split(',').map(s => s.trim()).filter(Boolean);

@Injectable()
export class Google {
  private client = new OAuth2Client();
  async verify(idToken: string): Promise<{ sub: string; name: string | null }> {
    const audiences = googleClientIds();
    if (!audiences.length) throw new Error('not configured');
    // Tests only (TEST_HOOKS=1, refused in production): Google's keys are replaced by a local test key.
    const testCerts = process.env.TEST_HOOKS === '1' && process.env.GOOGLE_TEST_CERTS ? JSON.parse(process.env.GOOGLE_TEST_CERTS) : null;
    const ticket = testCerts
      ? await this.client.verifySignedJwtWithCertsAsync(idToken, testCerts, audiences, ISSUERS)
      : await this.client.verifyIdToken({ idToken, audience: audiences });
    const p = ticket.getPayload();
    if (!p?.sub || !/^[0-9A-Za-z_-]{1,255}$/.test(p.sub) || !ISSUERS.includes(p.iss)) throw new Error('bad token');
    return { sub: p.sub, name: typeof p.name === 'string' ? p.name : null };
  }
}
