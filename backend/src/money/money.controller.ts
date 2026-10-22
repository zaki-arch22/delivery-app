import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import { Access, Who } from '../auth/guard';
import { fail } from '../common/errors';
import { MoneyService } from './money.service';

const who = (r: any): Who => r.who;
const pid = (r: any) => who(r).profileId as string;

@Controller()
export class MoneyController {
  constructor(private m: MoneyService) {}
  // Where this person receives money (one Algérie Poste account per account, for both profiles).
  @Access('account') @Get('get_payout_account') payout(@Req() r: any) { return this.m.getPayout(who(r).accountId); }
  @Access('account') @Post('set_payout_account') @HttpCode(200) setPayout(@Req() r: any, @Body() b: any) { return this.m.setPayout(who(r).accountId, who(r).profileId, r.ip, b); }

  // SELLER: money from cash-on-delivery sales
  @Access('user') @Get('list_sales') sales(@Req() r: any) { return this.m.listSales(pid(r)); }
  @Access('user') @Post('confirm_settlement') @HttpCode(200) confirm(@Req() r: any, @Body() b: any) { return this.m.confirm(pid(r), b?.order_id); }
  @Access('user') @Post('dispute_settlement') @HttpCode(200) dispute(@Req() r: any, @Body() b: any) { return this.m.dispute(pid(r), b?.order_id, b?.note); }

  // COURIER: goods money to send, and the prepaid wallet
  @Access('driver') @Get('list_settlements') settlements(@Req() r: any) { return this.m.listSettlements(pid(r)); }
  @Access('driver') @Post('mark_settlement_sent') @HttpCode(200) sent(@Req() r: any, @Body() b: any) { return this.m.markSent(pid(r), b); }
  @Access('driver') @Get('get_wallet') wallet(@Req() r: any) { return this.m.wallet(pid(r)); }
  @Access('driver') @Post('request_topup') @HttpCode(200) topup(@Req() r: any, @Body() b: any) { return this.m.requestTopup(pid(r), b); }

  // BOTH: the transfer receipt of one payment (its seller and its courier only)
  @Access('account') @Get('get_settlement_receipt') async receipt(@Req() r: any, @Query('order_id') o: string, @Res() res: any) {
    if (!pid(r) || who(r).status !== 'active') throw fail(403, 'PROFILE_NOT_ACTIVE', 'Profile is not active');
    const data = await this.m.receipt(pid(r), o);
    res.setHeader('Content-Type', 'image/jpeg'); res.setHeader('Cache-Control', 'private, no-store'); res.setHeader('Content-Disposition', 'inline'); res.end(data);
  }
}
