import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { Client } from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import { Db } from '../db/db.service';
import { readAccess } from '../auth/tokens';
import { clientIp } from '../security/middleware';
import { SecurityLog } from '../security/security-log.service';

interface Meta { sid: string; profileId: string }
const send = (ws: WebSocket, o: any) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

// Live connection: ws://host/ws
//   1) client sends {type:'auth', token, since?}   (since = id of the last notification it already has)
//   2) server answers {type:'ready'} and replays everything missed after `since`, in order
//   3) from then on every new notification for THAT profile arrives instantly: {type:'notification', id, kind, order_id, data, priority, created_at, expires_at}
// Clients de-duplicate and order by `id`. A socket belongs to one session and one profile; switching profile closes it.
@Injectable()
export class Realtime implements OnApplicationBootstrap, OnModuleDestroy {
  private log = new Logger('Realtime');
  private wss?: WebSocketServer;
  private meta = new WeakMap<WebSocket, Meta>();
  private byProfile = new Map<string, Set<WebSocket>>();
  private bySession = new Map<string, Set<WebSocket>>();
  private listener?: Client;
  private stopped = false;
  private beat?: NodeJS.Timeout;
    private perIp = new Map<string, number>();
  constructor(private host: HttpAdapterHost, private db: Db, private sec: SecurityLog) {}

  async onApplicationBootstrap() {
    this.wss = new WebSocketServer({ server: this.host.httpAdapter.getHttpServer(), path: '/ws', maxPayload: 8 * 1024 });   // oversized messages close the connection
    this.wss.on('error', e => this.log.error('wss: ' + e.message));
    this.wss.on('connection', (ws, req) => this.onConnection(ws, clientIp(req)));
    this.beat = setInterval(() => this.wss!.clients.forEach((ws: any) => { if (ws.dead) return ws.terminate(); ws.dead = true; ws.ping(); }), 25000);
    this.listen().catch(e => this.log.error(e.message));
  }
  onModuleDestroy() { this.stopped = true; if (this.beat) clearInterval(this.beat); this.listener?.end().catch(() => {}); this.wss?.close(); }

  private async listen() {
    while (!this.stopped) {
      try {
        const c = new Client({ connectionString: this.db.pool.options.connectionString });
        await c.connect(); this.listener = c;
        c.on('notification', m => this.deliver(Number(m.payload)).catch(e => this.log.error(e.message)));
        await c.query('LISTEN notif');
        await new Promise<void>(res => { c.on('end', res); c.on('error', () => res()); });
      } catch (e: any) { this.log.warn('listener retry: ' + e.message); }
      if (!this.stopped) await new Promise(r => setTimeout(r, 1000));
    }
  }

  private onConnection(ws: WebSocket, ip: string) {
    // Connection caps: per source address (stops socket flooding) and, after login, per profile.
    const open = (this.perIp.get(ip) ?? 0) + 1; this.perIp.set(ip, open);
    if (open > 30) { this.sec.event('ws_ip_cap', ip); ws.close(4429, 'too many connections'); }
    // An error event with no listener crashes the whole process: ALWAYS handle it (an oversized or malformed frame must only drop that one connection).
    ws.on('error', e => this.sec.event('ws_error', ip, { message: e.message }));
    let msgs = 0; const rate = setInterval(() => { msgs = 0; }, 10_000); rate.unref();
    const timer = setTimeout(() => ws.close(4401, 'auth timeout'), 5000);
    (ws as any).dead = false; ws.on('pong', () => ((ws as any).dead = false));
    ws.on('message', async raw => {
      if (++msgs > 30) { this.sec.event('ws_message_flood', ip); return ws.close(4429, 'too many messages'); }
      let m: any; try { m = JSON.parse(raw.toString()); } catch { return; }
      if (m.type === 'ping') return send(ws, { type: 'pong' });
      if (this.meta.has(ws) || m.type !== 'auth') return;
      try {
        const c = readAccess(String(m.token));
        const row = await this.db.one(`SELECT s.account_id, s.active_profile_id FROM sessions s WHERE s.id=$1 AND NOT s.revoked AND s.expires_at > now()`, [c.sid]);
        if (!row || !c.pid || row.active_profile_id !== c.pid) throw new Error('bad session');
        if ((this.byProfile.get(c.pid)?.size ?? 0) >= 5) throw new Error('too many connections for this profile');
        clearTimeout(timer);
        this.meta.set(ws, { sid: c.sid, profileId: c.pid });
        this.add(this.byProfile, c.pid, ws); this.add(this.bySession, c.sid, ws);
        send(ws, { type: 'ready' });
        await this.replay(ws, c.pid, Number(m.since) || 0);
      } catch { ws.close(4401, 'unauthorized'); }
    });
    ws.on('close', () => { clearTimeout(timer); clearInterval(rate); this.perIp.set(ip, Math.max(0, (this.perIp.get(ip) ?? 1) - 1)); const mt = this.meta.get(ws); if (mt) { this.del(this.byProfile, mt.profileId, ws); this.del(this.bySession, mt.sid, ws); } });
  }

  private add(m: Map<string, Set<WebSocket>>, k: string, ws: WebSocket) { (m.get(k) ?? m.set(k, new Set()).get(k)!).add(ws); }
  private del(m: Map<string, Set<WebSocket>>, k: string, ws: WebSocket) { const s = m.get(k); s?.delete(ws); if (s && !s.size) m.delete(k); }
  closeSession(sid: string) { this.bySession.get(sid)?.forEach(ws => ws.close(4403, 'profile changed')); }

  private payload(r: any) { return { type: 'notification', id: Number(r.id), kind: r.type, order_id: r.order_id, data: r.data, priority: r.priority, created_at: r.created_at, expires_at: r.expires_at }; }

  // Missed notifications. First connection (since = 0): only still-valid live items such as an open offer.
  private async replay(ws: WebSocket, profileId: string, since: number) {
    const rows = await this.db.query(
      `SELECT id, type, order_id, data, priority, created_at, expires_at FROM notifications
       WHERE profile_id=$1 AND id > $2 AND (expires_at IS NULL OR expires_at > now()) AND ($2 > 0 OR expires_at IS NOT NULL) ORDER BY id LIMIT 200`, [profileId, since]);
    for (const r of rows) send(ws, this.payload(r));
  }

  private async deliver(id: number) {
    const r = await this.db.one(`SELECT id, profile_id, type, order_id, data, priority, created_at, expires_at FROM notifications WHERE id=$1`, [id]);
    if (!r || (r.expires_at && new Date(r.expires_at) < new Date())) return;
    this.byProfile.get(r.profile_id)?.forEach(ws => send(ws, this.payload(r)));
  }
}
