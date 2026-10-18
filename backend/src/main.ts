import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { SecurityLog } from './security/security-log.service';
import { headers, inputGuard, ipLimit } from './security/middleware';
import { deriveKey } from './security/crypto';

// Last-resort safety nets. A stray failed background operation is logged, not allowed to take the platform down.
process.on('unhandledRejection', e => console.error('unhandled rejection:', e));
process.on('uncaughtException', e => { console.error('uncaught exception:', e); setTimeout(() => process.exit(1), 100); });   // restart cleanly under a supervisor

async function main() {
  if (process.env.NODE_ENV === 'production' && process.env.TEST_HOOKS === '1') throw new Error('TEST_HOOKS must never be enabled in production');
  deriveKey('JWT_SECRET', 'check'); deriveKey('HASH_PEPPER', 'check');   // refuse to start without strong secrets
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['error', 'warn', 'log'], bodyParser: false });
  const express = app.getHttpAdapter().getInstance();
  express.disable('x-powered-by');
  const hops = Number(process.env.TRUST_PROXY ?? 0); if (hops > 0) express.set('trust proxy', hops);   // behind a reverse proxy: real client addresses
  app.use(headers);
  app.use(ipLimit(app.get(SecurityLog)));
  app.useBodyParser('json', { limit: '64kb' });
  app.use(inputGuard);
  // Cross-origin access is DENIED unless the staff console's address is listed. Mobile apps do not need CORS.
  const allowed = new Set((process.env.STAFF_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean));
  app.enableCors({ origin: (o: string | undefined, cb: any) => cb(null, !!o && allowed.has(o)), methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'], maxAge: 600 });
  const server = await app.listen(Number(process.env.PORT ?? 3000));
  server.requestTimeout = 30_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 50;   // slow-request attacks
}
main();
