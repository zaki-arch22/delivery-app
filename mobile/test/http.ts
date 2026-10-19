// A small fetch for tests, built on Node's own http module. jest-expo replaces the global fetch with the phone's
// native one (which does not exist in tests), and other HTTP clients stall in that environment.
import http from 'http';

export const nodeFetch = ((url: string, init: any = {}) => new Promise((resolve, reject) => {
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
  if (init.body) req.write(init.body);
  req.end();
})) as unknown as typeof fetch;
