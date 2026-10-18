import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Db } from '../db/db.service';

// Hourly cleanup of technical leftovers that attackers could otherwise use to bloat the database (expired quotes, old login codes,
// dead sessions). Business records (orders, ledger, ratings, audit, security events) are NEVER deleted here.
@Injectable()
export class Maintenance implements OnModuleInit, OnModuleDestroy {
  private log = new Logger('Maintenance'); private timer?: NodeJS.Timeout;
  constructor(private db: Db) {}
  onModuleInit() { this.timer = setInterval(() => this.run().catch(e => this.log.error(e.message)), Number(process.env.MAINT_MS ?? 3_600_000)); this.timer.unref(); }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }
  async run() {
    await this.db.query(`DELETE FROM quotes WHERE expires_at < now() - interval '1 day'`);
    await this.db.query(`DELETE FROM otp_codes WHERE created_at < now() - interval '2 days'`);
    await this.db.query(`DELETE FROM sessions WHERE (revoked OR expires_at < now()) AND created_at < now() - interval '7 days'`);
  }
}
