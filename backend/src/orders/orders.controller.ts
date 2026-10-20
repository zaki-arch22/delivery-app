import { Body, Controller, Get, Headers, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import { Public } from '../auth/guard';
import { Tracking } from './tracking';
import { Access, Who } from '../auth/guard';
import { OrdersService } from './orders.service';
import { RatingsService } from './ratings.service';
import { DriverService } from '../driver/driver.service';
import { fail, point, uuid } from '../common/errors';
import { Places } from '../geo/places';

const who = (r: any): Who => r.who;
const pid = (r: any) => who(r).profileId as string;

// Photos go out as private, never-cached JPEG images.
const jpeg = (res: any, data: Buffer) => { res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Disposition', 'inline'); res.end(data); };

// ---------- RECEIVER: tracking link (no login; the secret link is the key) ----------
@Controller()
export class TrackingController {
  constructor(private t: Tracking) {}
  @Public() @Get('track_data') data(@Query('t') t: string) { return this.t.data(t); }
  @Public() @Get('track_qr') async qr(@Query('t') t: string, @Res() res: any) { const svg = await this.t.qr(t); res.setHeader('Content-Type', 'image/svg+xml'); res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'"); res.end(svg); }
  @Public() @Get('track_photo') async photo(@Query('t') t: string, @Res() res: any) { jpeg(res, await this.t.photo(t)); }
  @Public() @Post('track_confirm') @HttpCode(200) confirm(@Req() r: any, @Body() b: any) { return this.t.confirm(b?.t, r.ip); }
  @Public() @Post('track_decline') @HttpCode(200) decline(@Body() b: any) { return this.t.decline(b?.t, b?.reason); }
  @Public() @Post('track_expecting') @HttpCode(200) expecting(@Body() b: any) { return this.t.expecting(b?.t); }
  @Public() @Post('track_report') @HttpCode(200) report(@Body() b: any) { return this.t.report(b?.t, b?.reason, b?.note); }
}

// ---------- USER path ----------
@Controller()
export class UserOrdersController {
  constructor(private o: OrdersService, private places: Places) {}
  @Access('user') @Post('get_quote') @HttpCode(200) quote(@Req() r: any, @Body() b: any) { return this.o.getQuote(pid(r), b); }
  @Access('user') @Post('create_order') @HttpCode(200) create(@Req() r: any, @Headers('idempotency-key') k: string, @Body() b: any) { return this.o.createOrder(pid(r), k, b); }
  @Access('user') @Get('get_order') get(@Req() r: any, @Query('id') id: string) { uuid(id, 'id'); return this.o.viewForUser(id, pid(r)); }
  @Access('user') @Post('cancel_order') @HttpCode(200) cancel(@Req() r: any, @Body() b: any) { return this.o.cancel(pid(r), b?.order_id, b?.reason); }
  @Access('user') @Post('raise_price') @HttpCode(200) raise(@Req() r: any, @Body() b: any) { return this.o.raisePrice(pid(r), b?.order_id, b?.new_offered_da); }
  @Access('user') @Get('list_orders') list(@Req() r: any, @Query('page') p: string) { return this.o.list(pid(r), p); }
  @Access('user') @Post('recall_order') @HttpCode(200) recall(@Req() r: any, @Body() b: any) { return this.o.recall(pid(r), b?.order_id, b?.reason); }
  @Access('user') @Get('recipient_history') history(@Req() r: any, @Query('phone') p: string) { return this.o.recipientHistory(pid(r), p); }
  @Access('user') @Get('get_order_photo') async photo(@Req() r: any, @Query('order_id') o: string, @Query('id') id: string, @Res() res: any) { jpeg(res, await this.o.photo(pid(r), o, id)); }
  @Access('user') @Post('set_auto_accept') @HttpCode(200) auto(@Req() r: any, @Body() b: any) { return this.o.setAutoAccept(pid(r), b?.order_id, b?.on); }
  @Access('user') @Post('accept_bid') @HttpCode(200) acceptBid(@Req() r: any, @Body() b: any) { return this.o.acceptBid(pid(r), b?.order_id, b?.offer_id); }
  @Access('user') @Post('decline_bid') @HttpCode(200) declineBid(@Req() r: any, @Body() b: any) { return this.o.declineBid(pid(r), b?.order_id, b?.offer_id); }
  @Access('user') @Get('search_places') searchPlaces(@Req() r: any, @Query('q') q: string, @Query('lang') l: string, @Query('lat') lat: string, @Query('lng') lng: string) {
    const near = lat !== undefined && lng !== undefined ? point({ lat: Number(lat), lng: Number(lng) }, 'near') : null;
    return this.places.search(pid(r), q, l, near);
  }
  @Access('user') @Post('report_problem') @HttpCode(200) problem(@Req() r: any, @Body() b: any) { return this.o.reportProblem(pid(r), b?.order_id, b?.reason, b?.note, b?.photos ?? []); }
}

// ---------- DRIVER path ----------
@Controller()
export class DriverController {
  constructor(private d: DriverService) {}
  @Access('driver') @Post('set_online') @HttpCode(200) online(@Req() r: any, @Body() b: any) { return this.d.setOnline(pid(r), b?.online); }
  @Access('driver') @Post('update_location') @HttpCode(200) loc(@Req() r: any, @Body() b: any) { return this.d.updateLocation(pid(r), b); }
  @Access('driver') @Get('get_driver_home') home(@Req() r: any) { return this.d.home(pid(r)); }
  @Access('driver') @Get('list_requests') requests(@Req() r: any) { return this.d.listRequests(pid(r)); }
  @Access('driver') @Post('make_bid') @HttpCode(200) bid(@Req() r: any, @Body() b: any) { return this.d.makeBid(pid(r), b?.offer_id, b?.price_da); }
  @Access('driver') @Get('get_current_offer') offer(@Req() r: any) { return this.d.currentOffer(pid(r)); }
  @Access('driver') @Post('accept_offer') @HttpCode(200) accept(@Req() r: any, @Body() b: any) { return this.d.accept(pid(r), b?.offer_id); }
  @Access('driver') @Post('decline_offer') @HttpCode(200) decline(@Req() r: any, @Body() b: any) { return this.d.decline(pid(r), b?.offer_id); }
  @Access('driver') @Get('get_job') async job(@Req() r: any) { return { job: await this.d.job(pid(r)) }; }
  @Access('driver') @Post('update_job_step') @HttpCode(200) step(@Req() r: any, @Body() b: any) { return this.d.step(pid(r), b); }
  @Access('driver') @Post('submit_selfie') @HttpCode(200) selfie(@Req() r: any, @Body() b: any) { return this.d.submitSelfie(pid(r), b?.document_id); }
  @Access('driver') @Post('release_job') @HttpCode(200) release(@Req() r: any, @Body() b: any) { return this.d.releaseJob(pid(r), b); }
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
