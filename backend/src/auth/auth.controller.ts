import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { Access, Public, Who } from './guard';

const who = (req: any): Who => req.who;

@Controller()
export class AuthController {
  constructor(private auth: AuthService) {}

  @Public() @Post('send_code') @HttpCode(200)
  sendCode(@Req() r: any, @Body() b: any) { return this.auth.sendCode(b?.phone, r.ip); }

  @Public() @Post('verify_code') @HttpCode(200)
  verify(@Req() r: any, @Body() b: any) { return this.auth.verifyCode(b?.phone, b?.code, b?.path, r.ip); }

  @Public() @Post('refresh_token') @HttpCode(200)
  refresh(@Req() r: any, @Body() b: any) { return this.auth.refresh(b?.refresh_token, r.ip); }

  @Access('account') @Get('get_me')
  me(@Req() r: any) { return this.auth.getMe(who(r).accountId, who(r).profileId); }

  @Access('account') @Post('add_profile') @HttpCode(200)
  add(@Req() r: any, @Body() b: any) { return this.auth.addProfile(who(r).accountId, who(r).sid, who(r).profileId, b?.type, b?.display_name, b?.documents); }

  @Access('account') @Post('switch_profile') @HttpCode(200)
  sw(@Req() r: any, @Body() b: any) { return this.auth.switchProfile(who(r).accountId, who(r).sid, b?.type); }

  @Access('account') @Post('logout_everywhere') @HttpCode(200)
  everywhere(@Req() r: any) { return this.auth.logoutEverywhere(who(r).accountId, r.ip); }

  @Access('account') @Post('logout') @HttpCode(200)
  out(@Req() r: any) { return this.auth.logout(who(r).sid); }
}
