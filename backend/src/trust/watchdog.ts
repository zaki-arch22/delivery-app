import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db.service';
import { cfg } from '../common/config';
import { notify } from '../notify/notify';
import { flagOverdue } from '../money/money.service';

// Safety nets (TRUST_AND_SAFETY.md, step 4): every minute, open a staff case (once per order) when
//  - a driver carrying a parcel has sent no position for a while (phone off? stopped?): the sender is told we are checking;
//  - a parcel is still not delivered long after pickup;
//  - a driver accepted but has not picked up after a long time.
// Cases only: GPS and traffic can fail, so nothing here punishes anyone on its own.
@Injectable()
export class Watchdog implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Watchdog'); private timer?: NodeJS.Timeout;
  constructor(private db: Db) {}
  onModuleInit() { if (process.env.MATCHING_TICK === 'off') return; this.timer = setInterval(() => this.run().catch(e => this.log.error(e.message)), cfg.watchMs()); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run() {
    const lock = await this.db.one(`SELECT pg_try_advisory_lock(727002) AS ok`);
    if (!lock.ok) return;
    try {
      const checks: [string, string, string][] = [
        ['check:driver_silent', `o.status='picked_up' AND (d.last_location_at IS NULL OR d.last_location_at < now() - make_interval(mins => $1))`, String(cfg.silentMin())],
        ['check:parcel_overdue', `o.status='picked_up' AND o.picked_up_at < now() - make_interval(mins => $1)`, String(cfg.overdueMin())],
        ['check:pickup_late', `o.status='assigned' AND o.assigned_at < now() - make_interval(mins => $1)`, String(cfg.pickupLateMin())],
      ];
      for (const [reason, where, mins] of checks) {
        const found = await this.db.query(
          `SELECT o.id, o.ref, o.user_profile_id FROM orders o JOIN driver_details d ON d.profile_id=o.driver_profile_id
           WHERE ${where} AND NOT EXISTS (SELECT 1 FROM problem_reports r WHERE r.order_id=o.id AND r.reason=$2) LIMIT 100`, [Number(mins), reason]);
        for (const o of found) await this.db.tx(async q => {
          await q(`INSERT INTO problem_reports(order_id, reporter_kind, reason, note) VALUES ($1,'system',$2,$3)`, [o.id, reason, `Automatic check after ${mins} minutes`]);
          await q(`INSERT INTO order_events(order_id,type,data) VALUES ($1,'flag_check',$2)`, [o.id, { check: reason.slice(6) }]);
          if (reason === 'check:driver_silent') await notify(q, { profile: o.user_profile_id, kind: 'order.checking', order: o.id, dedupe: `order:${o.id}:checking`, data: { ref: o.ref } });
        });
      }
      await flagOverdue(this.db);   // goods money not sent to a seller within 24 hours
    } finally { await this.db.query(`SELECT pg_advisory_unlock(727002)`); }
  }
}
