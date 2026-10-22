import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db.service';
import { cfgN } from '../common/config';
import { pushText } from './notify';

export interface PushMsg { title: string; body: string; data: Record<string, string>; priority: 'high' | 'normal' }
export interface PushProvider { send(token: string, platform: string, m: PushMsg): Promise<'ok' | 'invalid_token'> }

// Test double, used ONLY when TEST_HOOKS=1: records what would be sent. Never used on a real server.
export class DevPush implements PushProvider {
  sent: { token: string; platform: string; m: PushMsg }[] = []; failNext = 0;
  async send(token: string, platform: string, m: PushMsg) { if (this.failNext > 0) { this.failNext--; throw new Error('simulated push failure'); } this.sent.push({ token, platform, m }); return 'ok' as const; }
}

// Real provider: Firebase Cloud Messaging serves Android directly (and iPhone through Apple, once an Apple key is added).
// Needs FIREBASE_SERVICE_ACCOUNT_JSON = the service-account key file from the Firebase project (pasted as is, or base64).
class FcmPush implements PushProvider {
  private app: any;
  readonly projectId: string;
  constructor(key: Record<string, any>) {
    const admin = require('firebase-admin');
    this.app = admin.initializeApp({ credential: admin.credential.cert(key) }, 'push');
    this.projectId = String(key.project_id ?? '');
  }
  async send(token: string, _platform: string, m: PushMsg) {
    try {
      await this.app.messaging().send({ token, notification: { title: m.title, body: m.body }, data: m.data,
        // channelId: the app's own HIGH-importance channel ("default", made by the app), so the banner pops up with sound.
        android: { priority: m.priority === 'high' ? 'high' : 'normal', notification: { channelId: 'default', sound: 'default' } },
        apns: { headers: { 'apns-priority': m.priority === 'high' ? '10' : '5' }, payload: { aps: { sound: 'default' } } } });
      return 'ok' as const;
    } catch (e: any) {
      // Only a token Firebase no longer knows is removed (a bad message must never wipe good phones).
      if (/registration-token-not-registered|invalid-registration-token/.test(e.code ?? '')) return 'invalid_token' as const;
      throw e;
    }
  }
}

// Reads the key however it was pasted: the JSON itself, the JSON with real line breaks inside the private key, or base64.
export function parseServiceAccount(raw: string): Record<string, any> {
  let txt = raw.trim();
  if (!txt.startsWith('{')) { try { txt = Buffer.from(txt, 'base64').toString('utf8').trim(); } catch { /* not base64 */ } }
  let key: any;
  try { key = JSON.parse(txt); } catch { key = JSON.parse(txt.replace(/\r?\n/g, '\\n')); }
  if (!key || key.type !== 'service_account' || !key.private_key || !key.client_email || !key.project_id)
    throw new Error('it is not a Firebase service-account key (type, project_id, client_email and private_key are needed)');
  key.private_key = String(key.private_key).replace(/\\n/g, '\n');
  return key;
}

@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Push');
  readonly dev = new DevPush();
  private provider: PushProvider | null = null;
  private timer?: NodeJS.Timeout;
  // What staff see on the dashboard: is phone push on, for which Firebase project, and the last error if any.
  private state: { active: boolean; project: string | null; problem: string | null; last_error: string | null; last_error_at: string | null } = { active: false, project: null, problem: null, last_error: null, last_error_at: null };
  status() { return { ...this.state }; }
  constructor(private db: Db) {}

  onModuleInit() {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    if (raw) {
      // A wrong key must never stop the server: push stays off, the reason is logged and shown to staff.
      try { const fcm = new FcmPush(parseServiceAccount(raw)); this.provider = fcm; this.state = { ...this.state, active: true, project: fcm.projectId }; this.log.log(`Phone push ON (Firebase project ${fcm.projectId})`); }
      catch (e: any) { this.state.problem = 'invalid_key'; this.log.error(`FIREBASE_SERVICE_ACCOUNT_JSON is not usable (${e?.message}): phone push is OFF`); }
    } else if (process.env.TEST_HOOKS === '1') { this.provider = this.dev; this.state = { ...this.state, active: true, project: 'test' }; }
    else { this.state.problem = 'no_key'; this.log.warn('No push provider configured (FIREBASE_SERVICE_ACCOUNT_JSON): phone push is OFF (the live connection still works)'); }
    this.timer = setInterval(() => this.tick().catch(e => this.log.error(e.message)), cfgN.pushTickMs());
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // Rows are claimed with SKIP LOCKED, so several server copies never send the same push twice.
  async tick() {
    await this.db.query(`UPDATE notifications SET push_state='skipped' WHERE push_state='pending' AND expires_at <= now()`);
    await this.db.tx(async q => {
      const rows = await q(`SELECT id, profile_id, type, order_id, data, priority, push_attempts FROM notifications
                            WHERE push_state='pending' AND push_next_at <= now() ORDER BY id LIMIT 50 FOR UPDATE SKIP LOCKED`);
      for (const n of rows) {
        const tokens = await q(`SELECT token, platform, language FROM device_tokens WHERE profile_id=$1`, [n.profile_id]);
        if (!tokens.length || !this.provider) { await q(`UPDATE notifications SET push_state='skipped' WHERE id=$1`, [n.id]); continue; }
        // Each phone of the profile gets it; the notification counts as sent when at least one phone got it. If none did
        // (Firebase down, network), it is tried again later with growing waits.
        let delivered = 0, failure: any = null;
        for (const t of tokens) {
          const txt = pushText(n.type, n.data, t.language); if (!txt) { delivered++; continue; }
          try {
            const res = await this.provider.send(t.token, t.platform, { title: txt[0], body: txt[1], priority: n.priority,
              data: { id: String(n.id), kind: n.type, order_id: n.order_id ?? '', ...Object.fromEntries(Object.entries(n.data ?? {}).map(([k, v]) => [k, String(v)])) } });
            if (res === 'invalid_token') await q(`DELETE FROM device_tokens WHERE token=$1`, [t.token]); else delivered++;
          } catch (e: any) {
            failure = e;
            this.state.last_error = `${e?.code ?? 'error'}: ${String(e?.message ?? '').slice(0, 200)}`; this.state.last_error_at = new Date().toISOString();
            this.log.warn(`Push to a ${t.platform} phone failed (${this.state.last_error})`);
          }
        }
        if (delivered > 0 || !failure) { await q(`UPDATE notifications SET push_state='sent' WHERE id=$1`, [n.id]); continue; }
        const a = n.push_attempts + 1;
        await q(`UPDATE notifications SET push_attempts=$2, push_state=$3, push_next_at = now() + make_interval(secs => $4::double precision) WHERE id=$1`,
          [n.id, a, a >= cfgN.maxAttempts() ? 'failed' : 'pending', cfgN.retryBaseS() * 2 ** (a - 1)]);
      }
    });
  }
}
