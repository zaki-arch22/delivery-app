import { Client } from './api';
import { KeyStore } from './storage';

export interface Notice { id: number; kind: string; order_id: string | null; data: Record<string, any>; priority: 'high' | 'normal'; created_at: string; expires_at: string | null }

// The live connection. It always reconnects, asks for everything missed since the last notification it saw
// (remembered per profile), and never delivers the same notification twice.
export class Realtime {
  private ws: WebSocket | null = null;
  private stopped = true;
  private attempt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private seen = new Set<number>();
  private subs = new Set<(n: Notice) => void>();
  private profileId: string | null = null;
  constructor(private client: Client, private store: KeyStore, private wsUrl: string, private WS: typeof WebSocket = WebSocket) {}

  onNotice(f: (n: Notice) => void) { this.subs.add(f); return () => this.subs.delete(f); }
  private sinceKey() { return 'since:' + this.profileId; }

  async start(profileId: string) { this.stop(); this.stopped = false; this.profileId = profileId; this.seen.clear(); await this.open(); }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); this.timer = null; const w = this.ws; this.ws = null; w?.close(); }

  private async open() {
    if (this.stopped) return;
    const since = Number((await this.store.get(this.sinceKey())) ?? 0);
    const ws = new this.WS(this.wsUrl); this.ws = ws;
    ws.onopen = () => ws.send(JSON.stringify({ type: 'auth', token: this.client.token, since }));
    ws.onmessage = async (e: any) => {
      let m: any; try { m = JSON.parse(String(e.data)); } catch { return; }
      if (m.type === 'ready') { this.attempt = 0; return; }
      if (m.type !== 'notification' || this.seen.has(m.id)) return;
      this.seen.add(m.id);
      const last = Number((await this.store.get(this.sinceKey())) ?? 0);
      if (m.id > last) await this.store.set(this.sinceKey(), String(m.id));
      const { type, ...n } = m; this.subs.forEach(f => f(n as Notice));
    };
    ws.onclose = async (e: any) => {
      if (this.ws !== ws || this.stopped) return;
      this.ws = null;
      if (e?.code === 4401) await this.client.refresh().catch(() => false);   // the access key expired: renew it, then reconnect
      if (e?.code === 4403) return;                                         // the profile was switched: the app restarts the connection itself
      const delay = Math.min(30_000, 1000 * 2 ** this.attempt++) * (0.75 + Math.random() * 0.5);   // 1s, 2s, 4s ... max 30s, with jitter
      this.timer = setTimeout(() => this.open(), delay);
    };
  }
}
