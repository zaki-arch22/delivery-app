import { Body, Controller, Get, Headers, HttpCode, Post, Query, Req } from '@nestjs/common';
import { Access, Who } from '../auth/guard';
import { OrdersService } from './orders.service';
import { RatingsService } from './ratings.service';
import { DriverService } from '../driver/driver.service';
import { fail, uuid } from '../common/errors';

const who = (r: any): Who => r.who;
const pid = (r: any) => who(r).profileId as string;

// ---------- USER path ----------
@Controller()
export class UserOrdersController {
  constructor(private o: OrdersService) {}
  @Access('user') @Post('get_quote') @HttpCode(200) quote(@Req() r: any, @Body() b: any) { return this.o.getQuote(pid(r), b); }
  @Access('user') @Post('create_order') @HttpCode(200) create(@Req() r: any, @Headers('idempotency-key') k: string, @Body() b: any) { return this.o.createOrder(pid(r), k, b); }
  @Access('user') @Get('get_order') get(@Req() r: any, @Query('id') id: string) { uuid(id, 'id'); return this.o.viewForUser(id, pid(r)); }
  @Access('user') @Post('cancel_order') @HttpCode(200) cancel(@Req() r: any, @Body() b: any) { return this.o.cancel(pid(r), b?.order_id, b?.reason); }
  @Access('user') @Post('raise_price') @HttpCode(200) raise(@Req() r: any, @Body() b: any) { return this.o.raisePrice(pid(r), b?.order_id, b?.new_offered_da); }
  @Access('user') @Get('list_orders') list(@Req() r: any, @Query('page') p: string) { return this.o.list(pid(r), p); }
  @Access('user') @Post('report_problem') @HttpCode(200) problem(@Req() r: any, @Body() b: any) { return this.o.reportProblem(pid(r), b?.order_id, b?.reason, b?.note); }
}

// ---------- DRIVER path ----------
@Controller()
export class DriverController {
  constructor(private d: DriverService) {}
  @Access('driver') @Post('set_online') @HttpCode(200) online(@Req() r: any, @Body() b: any) { return this.d.setOnline(pid(r), b?.online); }
  @Access('driver') @Post('update_location') @HttpCode(200) loc(@Req() r: any, @Body() b: any) { return this.d.updateLocation(pid(r), b); }
  @Access('driver') @Get('get_driver_home') home(@Req() r: any) { return this.d.home(pid(r)); }
  @Access('driver') @Get('get_current_offer') offer(@Req() r: any) { return this.d.currentOffer(pid(r)); }
  @Access('driver') @Post('accept_offer') @HttpCode(200) accept(@Req() r: any, @Body() b: any) { return this.d.accept(pid(r), b?.offer_id); }
  @Access('driver') @Post('decline_offer') @HttpCode(200) decline(@Req() r: any, @Body() b: any) { return this.d.decline(pid(r), b?.offer_id); }
  @Access('driver') @Get('get_job') async job(@Req() r: any) { return { job: await this.d.job(pid(r)) }; }
  @Access('driver') @Post('update_job_step') @HttpCode(200) step(@Req() r: any, @Body() b: any) { return this.d.step(pid(r), b); }
  @Access('driver') @Post('report_delivery_failure') @HttpCode(200) failure(@Req() r: any, @Body() b: any) { return this.d.failDelivery(pid(r), b); }
  @Access('driver') @Get('list_jobs') jobs(@Req() r: any, @Query('page') p: string) { return this.d.jobs(pid(r), p); }
  @Access('driver') @Get('get_cash_balance') cash(@Req() r: any) { return this.d.cash(pid(r)); }
}

// ---------- BOTH paths: ratings ----------
@Controller()
export class RatingsController {
  constructor(private s: RatingsService) {}
  // Active profile (user or driver) must be a real, active profile; the service checks it belongs to the order.
  @Access('account') @Post('submit_rating') @HttpCode(200) rate(@Req() r: any, @Body() b: any) {
    if (!pid(r) || who(r).status !== 'active') throw fail(403, 'PROFILE_NOT_ACTIVE', 'Profile is not active');
    return this.s.submit(pid(r), b);
  }
}
