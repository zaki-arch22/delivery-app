import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { SecurityLog } from './security/security-log.service';
import { headers, inputGuard, ipLimit } from './security/middleware';
import { deriveKey } from './security/crypto';
import { raw, static as serveStatic } from 'express';
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { MAX_UPLOAD_BYTES } from './documents/documents.service';

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
  // The receiver's tracking page: /t/<secret token>. The page itself is the same small file for everyone; its data comes from
  // /track_data with the token. It may load only its own files, talk only to this server, and draw map tiles from OpenFreeMap.
  const pub = join(__dirname, '..', 'public');
  const trackCsp = "default-src 'none'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data: blob: https://tiles.openfreemap.org; connect-src 'self' https://tiles.openfreemap.org; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
  app.use('/t', (req: any, res: any, next: any) => {
    res.setHeader('Content-Security-Policy', trackCsp);
    if (/^\/[A-Za-z0-9_-]{32}$/.test(req.path)) { res.setHeader('Cache-Control', 'no-store'); return res.sendFile(join(pub, 'track.html')); }
    next();
  }, serveStatic(join(pub, 'track'), { dotfiles: 'ignore', index: false, fallthrough: true, maxAge: '1h' }),
    serveStatic(join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist'), { dotfiles: 'ignore', index: false, maxAge: '1d' }),
    (_req: any, res: any) => res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' }));
  // Optional: the server also hands out the staff console's files at /staff/ (one address for a small or free host).
  // Same address = no cross-site access to open. The page may only run its own files and talk to this server.
  const consoleDir = process.env.STAFF_CONSOLE_DIR ? resolve(process.env.STAFF_CONSOLE_DIR) : '';
  if (consoleDir) {
    if (!existsSync(join(consoleDir, 'index.html'))) throw new Error('STAFF_CONSOLE_DIR has no index.html (build the staff console with VITE_BASE=/staff/)');
    app.use('/staff', (_req: any, res: any, next: any) => {
      res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
      next();
    }, serveStatic(consoleDir, { index: 'index.html', dotfiles: 'ignore', redirect: true }),
      (_req: any, res: any) => res.status(404).json({ error: 'NOT_FOUND', message: 'Not found' }));   // nothing else, no error details
  }
  // Photos are the only non-JSON body, accepted on ONE route only, up to 6 MB (everything else stays at 64 KB of JSON).
  // No login, no reading of a big body: anonymous callers are turned away before a single byte of the photo is read.
  const readPhoto = raw({ type: ['image/jpeg', 'image/png', 'image/webp'], limit: MAX_UPLOAD_BYTES });
  app.use('/upload_document', (req: any, res: any, next: any) => {
    if (!/^Bearer \S+$/.test(req.headers.authorization ?? '')) return res.status(401).json({ error: 'BAD_TOKEN', message: 'Login again' });
    readPhoto(req, res, (err: any) => err
      ? res.status(err.status === 413 ? 413 : 400).json(err.status === 413 ? { error: 'TOO_LARGE', message: 'The photo is larger than 6 MB' } : { error: 'BAD_INPUT', message: 'Invalid upload' })
      : next());
  });
  app.useBodyParser('json', { limit: '64kb' });
  app.use(inputGuard);
  // Cross-origin access is DENIED unless the staff console's address is listed. Mobile apps do not need CORS.
  const allowed = new Set((process.env.STAFF_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean));
  app.enableCors({ origin: (o: string | undefined, cb: any) => cb(null, !!o && allowed.has(o)), methods: ['GET', 'POST'], allowedHeaders: ['Authorization', 'Content-Type', 'Idempotency-Key'], maxAge: 600 });
  const server = await app.listen(Number(process.env.PORT ?? 3000));
  server.requestTimeout = 30_000; server.headersTimeout = 15_000; server.keepAliveTimeout = 5_000; server.maxHeadersCount = 50;   // slow-request attacks
}
main();
