// Base64 text -> bytes (no dependency on the phone's own decoder). A lookup table keeps a 1 MB photo fast.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const LOOKUP = new Uint8Array(128); for (let i = 0; i < B64.length; i++) LOOKUP[B64.charCodeAt(i)] = i;
export function base64Bytes(s: string): Uint8Array {
  const clean = s.replace(/[^A-Za-z0-9+/]/g, ''), n = clean.length, out = new Uint8Array(Math.floor((n * 3) / 4));
  let o = 0;
  for (let i = 0; i < n; i += 4) {
    const a = LOOKUP[clean.charCodeAt(i)], b = LOOKUP[clean.charCodeAt(i + 1)], c = i + 2 < n ? LOOKUP[clean.charCodeAt(i + 2)] : 0, d = i + 3 < n ? LOOKUP[clean.charCodeAt(i + 3)] : 0;
    const v = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (v >> 16) & 255; if (i + 2 < n) out[o++] = (v >> 8) & 255; if (i + 3 < n) out[o++] = v & 255;
  }
  return out.subarray(0, o);
}
