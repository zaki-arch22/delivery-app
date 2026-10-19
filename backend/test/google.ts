// Test stand-in for Google: makes sign-in proofs ("ID tokens") signed with a LOCAL test key. The test server trusts this
// key only because TEST_HOOKS=1 and GOOGLE_TEST_CERTS are set (refused in production). Key made by scripts/test-all.sh.
import { createSign, generateKeyPairSync } from 'crypto';
import { readFileSync } from 'fs';
const b64 = (o: any) => Buffer.from(JSON.stringify(o)).toString('base64url');
export const GOOGLE_AUD = () => (process.env.GOOGLE_CLIENT_IDS ?? '').split(',')[0];
export function googleToken(sub: string, over: Record<string, any> = {}, key = readFileSync(process.env.GOOGLE_TEST_KEY_FILE!, 'utf8'), kid = 'test-key-1') {
  const now = Math.floor(Date.now() / 1000);
  const head = b64({ alg: 'RS256', kid, typ: 'JWT' });
  const body = b64({ iss: 'https://accounts.google.com', aud: GOOGLE_AUD(), sub, name: 'Test Person', iat: now, exp: now + 3600, ...over });
  const sig = createSign('RSA-SHA256').update(`${head}.${body}`).sign(key).toString('base64url');
  return `${head}.${body}.${sig}`;
}
// A key Google never gave anyone: proofs signed with it must be refused.
export const otherKey = () => generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
