import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Access, Public } from '../auth/guard';
import { Sms } from '../auth/sms.service';
import { PushService } from '../notify/push.service';
import { Watchdog } from '../trust/watchdog';

const TUNABLE = ['SELFIE_DAYS', 'SILENT_MIN', 'OVERDUE_MIN', 'PICKUP_LATE_MIN', 'REPORT_HOURS'];

// TEST HOOKS. This controller is loaded ONLY when TEST_HOOKS=1 (automated tests). The server refuses to start
// with TEST_HOOKS=1 in production, so none of these routes can ever exist on a real server.
@Controller('dev')
export class DevController {
  constructor(private sms: Sms, private push: PushService, private watchdog: Watchdog) {}
  @Public() @Get('last_code') code(@Query('phone') p: string) { return { code: this.sms.lastCode.get(p) ?? null }; }
  @Access('user') @Get('only_user') onlyUser() { return { ok: 'user area' }; }
  @Access('driver') @Get('only_driver') onlyDriver() { return { ok: 'driver area' }; }
  @Public() @Get('pushes') pushes(@Query('token') t: string) { return { sent: this.push.dev.sent.filter(x => !t || x.token === t) }; }
  // Tests change a tunable value or run the safety nets at once (test servers only).
  @Public() @Post('config') config(@Body() b: any) { if (!TUNABLE.includes(b?.key)) return { ok: false }; process.env[b.key] = String(Number(b.value)); return { ok: true }; }
  @Public() @Post('watchdog') async runWatchdog() { await this.watchdog.run(); return { ok: true }; }
  @Public() @Post('fail_next') failNext(@Body() b: any) { this.push.dev.failNext = b?.push ?? 0; return { ok: true }; }
}
