// The Firebase key is read however the owner pastes it into Render (JSON, pretty JSON, broken lines, base64); a wrong file is refused.
import { parseServiceAccount } from '../src/notify/push.service';
const k = { type: 'service_account', project_id: 'p1', client_email: 'a@b.iam', private_key: '-----BEGIN PRIVATE KEY-----\nABC\nDEF\n-----END PRIVATE KEY-----\n' };
const j = JSON.stringify(k);
let pass = 0, fail = 0;
const ok = (n: string, c: boolean) => { c ? pass++ : fail++; console.log((c ? 'PASS  ' : 'FAIL  ') + n); };
ok('plain json', parseServiceAccount(j).private_key === k.private_key);
ok('pretty json', parseServiceAccount(JSON.stringify(k, null, 2)).project_id === 'p1');
ok('raw newlines in key', parseServiceAccount(j.replace(/\\n/g, '\n')).private_key === k.private_key);
ok('base64', parseServiceAccount(Buffer.from(j).toString('base64')).client_email === 'a@b.iam');
let threw = false; try { parseServiceAccount('{"type":"x"}'); } catch { threw = true; } ok('wrong file refused', threw);
threw = false; try { parseServiceAccount('garbage'); } catch { threw = true; } ok('garbage refused', threw);
console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
