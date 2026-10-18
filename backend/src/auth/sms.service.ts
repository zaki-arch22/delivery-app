import { Injectable, Logger } from '@nestjs/common';

// SMS is used ONLY to verify a phone number at login (the 6-digit code). Nothing else is ever sent by SMS.
// The real SMS provider is plugged in here later (one method). Until then codes go to the log in dev mode only.
@Injectable()
export class Sms {
  private log = new Logger('Sms');
  lastCode = new Map<string, string>();
  async send(phone: string, text: string) {
    if (process.env.TEST_HOOKS === '1') { this.lastCode.set(phone, text.match(/\d{6}/)?.[0] ?? ''); this.log.log(`[test] ${phone}: ${text}`); return; }
    throw new Error('SMS provider not configured');
  }
}
