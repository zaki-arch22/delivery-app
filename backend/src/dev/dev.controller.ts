import { Body, Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Access, Public } from '../auth/guard';
import { Sms } from '../auth/sms.service';
import { PushService } from '../notify/push.service';

// TEST HOOKS. This controller is loaded ONLY when TEST_HOOKS=1 (automated tests). The server refuses to start
// with TEST_HOOKS=1 in production, so none of these routes can ever exist on a real server.
@Controller('dev')
export class DevController {
  constructor(private sms: Sms, private push: PushService) {}
  @Public() @Get('last_code') code(@Query('phone') p: string) { return { code: this.sms.lastCode.get(p) ?? null }; }
  @Access('user') @Get('only_user') onlyUser() { return { ok: 'user area' }; }
  @Access('driver') @Get('only_driver') onlyDriver() { return { ok: 'driver area' }; }
  @Public() @Get('pushes') pushes(@Query('token') t: string) { return { sent: this.push.dev.sent.filter(x => !t || x.token === t) }; }
  @Public() @Post('fail_next') failNext(@Body() b: any) { this.push.dev.failNext = b?.push ?? 0; return { ok: true }; }
}
