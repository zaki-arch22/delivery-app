import { ApiError, Client } from './api';
import { KeyStore } from './storage';

// Driver job steps made without network ("picked up", "delivered") are kept on the phone and sent, in order, as soon as
// the server can be reached. The server accepts a repeated step safely, so sending twice is harmless.
export interface StepItem { order_id: string; step: 'picked_up' | 'delivered'; delivery_code?: string; cash_collected_da?: number; queued_at: string }
export type QueueEvent = { item: StepItem; sent: true } | { item: StepItem; sent: false; error: ApiError };
const KEY = 'job_steps';

export class StepQueue {
  private items: StepItem[] | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing: Promise<void> | null = null;
  private subs = new Set<(e: QueueEvent) => void>();
  constructor(private client: Client, private store: KeyStore, private retryMs = 10_000) {}

  onEvent(f: (e: QueueEvent) => void) { this.subs.add(f); return () => this.subs.delete(f); }
  private async list() { if (!this.items) { try { this.items = JSON.parse((await this.store.get(KEY)) ?? '[]'); } catch { this.items = []; } } return this.items!; }
  private save() { return this.store.set(KEY, JSON.stringify(this.items ?? [])); }
  async pending(orderId?: string) { return (await this.list()).filter(i => !orderId || i.order_id === orderId); }

  // Try now; if there is no network, keep it and try again later. Returns true if the server already has it.
  async send(item: Omit<StepItem, 'queued_at'>): Promise<boolean> {
    const list = await this.list();
    list.push({ ...item, queued_at: new Date().toISOString() });
    await this.save();
    await this.flush();
    return !(await this.pending(item.order_id)).some(i => i.step === item.step);
  }

  flush(): Promise<void> {
    if (!this.flushing) this.flushing = this.run().finally(() => { this.flushing = null; });
    return this.flushing;
  }
  private async run() {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    const list = await this.list();
    while (list.length) {
      const item = list[0];
      try {
        await this.client.call('/update_job_step', { order_id: item.order_id, step: item.step, delivery_code: item.delivery_code, cash_collected_da: item.cash_collected_da });
        list.shift(); await this.save(); this.subs.forEach(f => f({ item, sent: true }));
      } catch (e) {
        const err = e instanceof ApiError ? e : new ApiError(0, 'NETWORK', '');
        if (err.status === 0 || err.status === 429 || err.status >= 500) { this.timer = setTimeout(() => this.flush(), this.retryMs); return; }   // try again later
        list.shift(); await this.save(); this.subs.forEach(f => f({ item, sent: false, error: err }));                                     // the server said no: tell the driver
      }
    }
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
}
