import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { AuthService, deviceOf } from './auth.service';
import { TrustService } from '../trust/trust.service';
import { Access, Public, Who } from './guard';
import { cfg } from '../common/config';

const who = (req: any): Who => req.who;

@Controller()
export class AuthController {
  constructor(private auth: AuthService, private trust: TrustService) {}

  @Public() @Get('login_methods')
  methods() { return this.auth.loginMethods(); }

  // What the app may show (the server decides): today only whether place search is switched on.
  @Public() @Get('app_config')
  config() { return { place_search: !!cfg.geocoderUrl() }; }

  @Access('account') @Post('rename_profile') @HttpCode(200)
  rename(@Req() r: any, @Body() b: any) { return this.auth.renameProfile(who(r).profileId, b?.display_name); }

  @Public() @Post('login_google') @HttpCode(200)
  google(@Req() r: any, @Body() b: any) { return this.auth.loginGoogle(b?.id_token, b?.path, r.ip, deviceOf(r.headers['x-device'])); }

  @Access('account') @Post('set_phone') @HttpCode(200)
  setPhone(@Req() r: any, @Body() b: any) { return this.auth.setPhone(who(r).accountId, b?.phone); }

  @Public() @Post('send_code') @HttpCode(200)
  sendCode(@Req() r: any, @Body() b: any) { return this.auth.sendCode(b?.phone, r.ip); }

  @Public() @Post('verify_code') @HttpCode(200)
  verify(@Req() r: any, @Body() b: any) { return this.auth.verifyCode(b?.phone, b?.code, b?.path, r.ip, deviceOf(r.headers['x-device'])); }

  @Public() @Post('refresh_token') @HttpCode(200)
  refresh(@Req() r: any, @Body() b: any) { return this.auth.refresh(b?.refresh_token, r.ip, deviceOf(r.headers['x-device'])); }

  @Access('account') @Get('get_me')
  me(@Req() r: any) { return this.auth.getMe(who(r).accountId, who(r).profileId); }

  @Access('account') @Post('add_profile') @HttpCode(200)
  add(@Req() r: any, @Body() b: any) { return this.auth.addProfile(who(r).accountId, who(r).sid, who(r).profileId, b?.type, b?.display_name, b?.documents, b?.accept_rules, b?.national_id); }

  @Access('account') @Post('switch_profile') @HttpCode(200)
  sw(@Req() r: any, @Body() b: any) { return this.auth.switchProfile(who(r).accountId, who(r).sid, b?.type); }

  // The person's own rule record, and appeals. Allowed even while blocked or banned (they can always see why and answer).
  @Access('account') @Get('my_record') record(@Req() r: any) { return this.trust.myRecord(who(r).profileId); }
  @Access('account') @Post('emergency') @HttpCode(200) emergency(@Req() r: any, @Body() b: any) { return this.trust.emergency(who(r).profileId, b); }
  @Access('account') @Post('appeal_violation') @HttpCode(200) appeal(@Req() r: any, @Body() b: any) { return this.trust.appeal(who(r).profileId, b); }

  @Access('account') @Post('logout_everywhere') @HttpCode(200)
  everywhere(@Req() r: any) { return this.auth.logoutEverywhere(who(r).accountId, r.ip); }

  @Access('account') @Post('delete_account') @HttpCode(200)
  del(@Req() r: any, @Body() b: any) { return this.auth.deleteAccount(who(r).accountId, r.ip, b); }

  @Access('account') @Post('logout') @HttpCode(200)
  out(@Req() r: any) { return this.auth.logout(who(r).sid); }
}
