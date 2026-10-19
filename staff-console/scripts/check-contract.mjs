// Proves the console and the backend match: every call the console makes exists on the server,
// and every staff function on the server has a place in the console. No button without a function, no function without a screen.
import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';
// Staff functions live in the staff controller, plus the staff-only route that shows driver document photos.
const backend = readFileSync('../backend/src/staff/staff.controller.ts', 'utf8') + readFileSync('../backend/src/documents/documents.controller.ts', 'utf8');
const server = new Set([...backend.matchAll(/@(?:Access\('staff'\)|Public\(\)) @(?:Get|Post)\('([a-z_]+)'\)/g)].map(m => m[1]));
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : /\.tsx?$/.test(p) ? [p] : []; });
const used = new Set(walk('src').flatMap(f => [...readFileSync(f, 'utf8').matchAll(/['"`]\/([a-z_]+)['"`?]/g)].map(m => m[1])));
const missingOnServer = [...used].filter(x => !server.has(x));
const missingInConsole = [...server].filter(x => !used.has(x));
console.log(`server staff functions: ${server.size}   used by the console: ${[...used].filter(x => server.has(x)).length}`);
if (missingOnServer.length) console.log('CONSOLE CALLS THAT DO NOT EXIST ON THE SERVER:', missingOnServer);
if (missingInConsole.length) console.log('SERVER FUNCTIONS WITH NO SCREEN:', missingInConsole);
if (missingOnServer.length || missingInConsole.length) process.exit(1);
console.log('MATCH: every console call exists on the server, and every staff function has a screen.');
