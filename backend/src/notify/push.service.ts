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

// Real provider: Firebase Cloud Messaging serves Android directly and iPhone through Apple's push service.
// Needs FIREBASE_SERVICE_ACCOUNT_JSON. NOT yet tested against real Firebase (no credentials available here).
class FcmPush implements PushProvider {
  private app: any;
  constructor(json: string) { const admin = require('firebase-admin'); this.app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) }); }
  async send(token: string, _platform: string, m: PushMsg) {
    try {
      await this.app.messaging().send({ token, notification: { title: m.title, body: m.body }, data: m.data,
        // channelId: the app's own HIGH-importance channel ("default", made by the app), so the banner pops up with sound.
        android: { priority: m.priority === 'high' ? 'high' : 'normal', notification: { channelId: 'default', sound: 'default' } },
        apns: { headers: { 'apns-priority': m.priority === 'high' ? '10' : '5' }, payload: { aps: { sound: 'default' } } } });
      return 'ok' as const;
    } catch (e: any) { if (/not-registered|invalid-registration|invalid-argument/.test(e.code ?? '')) return 'invalid_token' as const; throw e; }
  }
}

@Injectable()
export class PushService implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Push');
  readonly dev = new DevPush();
  private provider: PushProvider | null = null;
  private timer?: NodeJS.Timeout;
  constructor(private db: Db) {}

  onModuleInit() {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) this.provider = new FcmPush(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
    else if (process.env.TEST_HOOKS === '1') this.provider = this.dev;
    else this.log.warn('No push provider configured: push notifications are skipped (live connection still works)');
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
        try {
          for (const t of tokens) {
            const txt = pushText(n.type, n.data, t.language); if (!txt) continue;
            const res = await this.provider.send(t.token, t.platform, { title: txt[0], body: txt[1], priority: n.priority,
              data: { id: String(n.id), kind: n.type, order_id: n.order_id ?? '', ...Object.fromEntries(Object.entries(n.data ?? {}).map(([k, v]) => [k, String(v)])) } });
            if (res === 'invalid_token') await q(`DELETE FROM device_tokens WHERE token=$1`, [t.token]);
          }
          await q(`UPDATE notifications SET push_state='sent' WHERE id=$1`, [n.id]);
        } catch {
          const a = n.push_attempts + 1;
          await q(`UPDATE notifications SET push_attempts=$2, push_state=$3, push_next_at = now() + make_interval(secs => $4::double precision) WHERE id=$1`,
            [n.id, a, a >= cfgN.maxAttempts() ? 'failed' : 'pending', cfgN.retryBaseS() * 2 ** (a - 1)]);
        }
      }
    });
  }
}
