import { Injectable, Logger } from '@nestjs/common';
import { Db } from '../db/db.service';

// Permanent record of suspicious or security-relevant events. Repeats of the same event from the same source are
// throttled to one per minute, so an attacker cannot flood the log or the database through it.
@Injectable()
export class SecurityLog {
  private log = new Logger('Security');
  private recent = new Map<string, number>();
  constructor(private db: Db) { setInterval(() => { const c = Date.now() - 120_000; for (const [k, t] of this.recent) if (t < c) this.recent.delete(k); }, 60_000).unref(); }
  event(type: string, ip: string | undefined, detail: Record<string, any> = {}, who: { account?: string; staff?: string } = {}) {
    const key = `${type}|${ip}|${who.account ?? ''}${who.staff ?? ''}`, now = Date.now();
    if ((this.recent.get(key) ?? 0) > now - 60_000) return;
    this.recent.set(key, now);
    this.db.query(`INSERT INTO security_events(type, ip, account_id, staff_id, detail) VALUES ($1,$2,$3,$4,$5)`, [type, ip ?? null, who.account ?? null, who.staff ?? null, detail]).catch(e => this.log.error(e.message));
  }
}
