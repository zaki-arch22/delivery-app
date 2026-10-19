// A small fetch for tests, built on Node's own http module. jest-expo replaces the global fetch with the phone's
// native one (which does not exist in tests), and other HTTP clients stall in that environment.
import http from 'http';

export const nodeFetch = (async (url: string, init: any = {}) => {
  // A photo (Blob) is turned into plain bytes first.
  const body = init.body && typeof init.body.arrayBuffer === 'function' ? Buffer.from(await init.body.arrayBuffer()) : init.body;
  return new Promise((resolve, reject) => {
  const req = http.request(url, { method: init.method ?? 'GET', headers: init.headers ?? {} }, res => {
    let body = '';
    res.setEncoding('utf8');
    res.on('data', c => { body += c; });
    res.on('end', () => {
      const status = res.statusCode ?? 0;
      resolve({
        ok: status >= 200 && status < 300, status,
        headers: { get: (k: string) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v[0] : v ?? null; } },
        json: async () => JSON.parse(body), text: async () => body,
      });
    });
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
  });
}) as unknown as typeof fetch;
