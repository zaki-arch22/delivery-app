import { Body, Controller, Get, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Access, Public } from '../auth/guard';
import { StaffService } from './staff.service';

const sid = (r: any): string => r.staff.id;

@Controller()
export class StaffController {
  constructor(private s: StaffService) {}
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

  @Access('staff') @Get('get_pricing') pricing() { return this.s.getPricing(); }
  @Access('staff') @Post('create_pricing_version') @HttpCode(200) price(@Req() r: any, @Body() b: any) { return this.s.createPricing(sid(r), b); }
}
