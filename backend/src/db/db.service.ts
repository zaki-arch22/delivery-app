import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Pool } from 'pg';

function required(k: string) { const v = process.env[k]; if (!v) throw new Error(`${k} is required`); return v; }

@Injectable()
export class Db implements OnModuleDestroy {
  readonly pool = new Pool({ connectionString: required('DATABASE_URL') });
  constructor() { this.pool.on('error', e => console.error('database pool error (connection dropped):', e.message)); }   // an idle connection dying must not crash the server
  query<T = any>(sql: string, params: any[] = []) { return this.pool.query(sql, params).then(r => r.rows as T[]); }
  async one<T = any>(sql: string, params: any[] = []) { return (await this.query<T>(sql, params))[0] ?? null; }
  async tx<T>(fn: (q: (sql: string, p?: any[]) => Promise<any[]>) => Promise<T>): Promise<T> {
    const c = await this.pool.connect();
    try { await c.query('BEGIN'); const r = await fn((s, p = []) => c.query(s, p).then(x => x.rows)); await c.query('COMMIT'); return r; }
    catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
  }
  onModuleDestroy() { return this.pool.end(); }
}
