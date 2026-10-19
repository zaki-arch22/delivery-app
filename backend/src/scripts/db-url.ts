// Prints a database address for the start script of a small host (deploy/render-start.sh). Usage:
//   node dist/scripts/db-url.js owner   -> OWNER_DATABASE_URL, cleaned
//   node dist/scripts/db-url.js app     -> the same database, but as the LIMITED role (delivery_app + APP_DB_PASSWORD)
// Neon's "pooled" address (host ending in -pooler) cannot carry the live-notification channel (LISTEN), so the direct
// address is always used.
const which = process.argv[2], raw = process.env.OWNER_DATABASE_URL;
if (!raw) { console.error('OWNER_DATABASE_URL is missing'); process.exit(1); }
let u: URL; try { u = new URL(raw.trim()); } catch { console.error('OWNER_DATABASE_URL is not a valid address'); process.exit(1); }
if (!/^postgres(ql)?:$/.test(u.protocol)) { console.error('OWNER_DATABASE_URL must start with postgres:// or postgresql://'); process.exit(1); }
u.hostname = u.hostname.replace(/-pooler(?=\.)/, '');
if (which === 'app') {
  const pw = process.env.APP_DB_PASSWORD ?? '';
  if (pw.length < 16) { console.error('APP_DB_PASSWORD (at least 16 characters) is missing'); process.exit(1); }
  u.username = process.env.APP_DB_ROLE ?? 'delivery_app'; u.password = pw;
} else if (which !== 'owner') { console.error('usage: db-url owner|app'); process.exit(1); }
process.stdout.write(u.toString());
