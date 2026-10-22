import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Access, Public } from '../auth/guard';
import { StaffService } from './staff.service';
import { TrustService } from '../trust/trust.service';
import { StaffMoneyService } from './staff-money.service';

const sid = (r: any): string => r.staff.id;

@Controller()
export class StaffController {
  constructor(private s: StaffService, private t: TrustService, private m: StaffMoneyService) {}
  @Public() @Post('staff_login') @HttpCode(200) login(@Req() r: any, @Body() b: any) { return this.s.login(b?.email, b?.password, b?.code, r.ip); }
  @Access('staff') @Post('staff_logout') @HttpCode(200) logout(@Req() r: any) { return this.s.logout(sid(r)); }

  @Access('staff') @Get('list_pending_drivers') pending() { return this.s.pendingDrivers(); }
  @Access('staff') @Post('approve_driver') @HttpCode(200) approve(@Req() r: any, @Body() b: any) { return this.s.approveDriver(sid(r), b); }
  @Access('staff') @Post('reject_driver') @HttpCode(200) reject(@Req() r: any, @Body() b: any) { return this.s.rejectDriver(sid(r), b); }
  @Access('staff') @Post('suspend_profile') @HttpCode(200) suspend(@Req() r: any, @Body() b: any) { return this.s.setSuspended(sid(r), b, true); }
  @Access('staff') @Post('unsuspend_profile') @HttpCode(200) unsuspend(@Req() r: any, @Body() b: any) { return this.s.setSuspended(sid(r), b, false); }
  @Access('staff') @Get('list_drivers') drivers(@Query() q: any) { return this.s.listDrivers(q); }

  @Access('staff') @Get('list_all_orders') orders(@Query() q: any) { return this.s.listOrders(q); }
  @Access('staff') @Get('get_order_timeline') timeline(@Query('id') id: string) { return this.s.timeline(id); }
  @Access('staff') @Post('staff_order_action') @HttpCode(200) action(@Req() r: any, @Body() b: any) { return this.s.orderAction(sid(r), b); }

  @Access('staff') @Get('list_problems') problems(@Query() q: any) { return this.s.listProblems(q); }
  @Access('staff') @Post('resolve_problem') @HttpCode(200) resolve(@Req() r: any, @Body() b: any) { return this.s.resolveProblem(sid(r), b); }
  @Access('staff') @Get('list_ratings') ratings(@Query() q: any) { return this.s.listRatings(q); }

  @Access('staff') @Get('get_driver_cash') cash(@Query('profile_id') id: string) { return this.s.driverCash(id); }
  @Access('staff') @Post('record_cash_handover') @HttpCode(200) handover(@Req() r: any, @Body() b: any) { return this.s.handover(sid(r), b); }
  @Access('staff') @Post('add_cash_adjustment') @HttpCode(200) adjust(@Req() r: any, @Body() b: any) { return this.s.adjustment(sid(r), b); }

  @Access('staff') @Post('create_zone') @HttpCode(200) zone(@Req() r: any, @Body() b: any) { return this.s.createZone(sid(r), b); }
  @Access('staff') @Get('list_zones') zones() { return this.s.listZones(); }
  @Access('staff') @Post('set_zone_open') @HttpCode(200) open(@Req() r: any, @Body() b: any) { return this.s.setZoneOpen(sid(r), b); }

  // Rules and sanctions (TRUST_AND_SAFETY.md)
  @Access('staff') @Get('list_violations') violations(@Query() q: any) { return this.t.listViolations(q); }
  @Access('staff') @Post('add_violation') @HttpCode(200) addViolation(@Req() r: any, @Body() b: any) { return this.t.addViolation(sid(r), b); }
  @Access('staff') @Post('decide_violation') @HttpCode(200) decide(@Req() r: any, @Body() b: any) { return this.t.decide(sid(r), b); }
  @Access('staff') @Get('list_sanctions') sanctions(@Query() q: any) { return this.t.listSanctions(q); }
  @Access('staff') @Post('block_profile') @HttpCode(200) block(@Req() r: any, @Body() b: any) { return this.t.block(sid(r), b); }
  @Access('staff') @Post('lift_sanction') @HttpCode(200) lift(@Req() r: any, @Body() b: any) { return this.t.lift(sid(r), b); }
  @Access('staff') @Post('ban_account') @HttpCode(200) ban(@Req() r: any, @Body() b: any) { return this.t.ban(sid(r), b); }
  @Access('staff') @Get('get_profile_record') record(@Query('profile_id') id: string) { return this.t.profileRecord(id); }

  // Money: seller payments, courier wallets, cash limits
  @Access('staff') @Get('list_settlements_staff') settlements(@Query() q: any) { return this.m.listSettlements(q); }
  @Access('staff') @Post('resolve_settlement') @HttpCode(200) resolveSettlement(@Req() r: any, @Body() b: any) { return this.m.resolveSettlement(sid(r), b); }
  @Access('staff') @Get('list_topups') topups(@Query() q: any) { return this.m.listTopups(q); }
  @Access('staff') @Post('decide_topup') @HttpCode(200) decideTopup(@Req() r: any, @Body() b: any) { return this.m.decideTopup(sid(r), b); }
  @Access('staff') @Get('get_driver_wallet') wallet(@Query('profile_id') id: string) { return this.m.getWallet(id); }
  @Access('staff') @Post('add_wallet_adjustment') @HttpCode(200) walletAdjust(@Req() r: any, @Body() b: any) { return this.m.walletAdjust(sid(r), b); }
  @Access('staff') @Post('set_cash_limit') @HttpCode(200) cashLimit(@Req() r: any, @Body() b: any) { return this.m.setCashLimit(sid(r), b); }

  // Overview: dashboard, live feed, audit log, customers
  @Access('staff') @Get('get_dashboard') dashboard() { return this.m.dashboard(); }
  @Access('staff') @Get('get_staff_feed') feed(@Query() q: any) { return this.m.feed(q); }
  @Access('staff') @Get('list_audit_log') auditLog(@Query() q: any) { return this.m.auditLog(q); }
  @Access('staff') @Get('list_users') users(@Query() q: any) { return this.m.listUsers(q); }

  @Access('staff') @Get('get_pricing') pricing() { return this.s.getPricing(); }
  @Access('staff') @Post('create_pricing_version') @HttpCode(200) price(@Req() r: any, @Body() b: any) { return this.s.createPricing(sid(r), b); }
}
