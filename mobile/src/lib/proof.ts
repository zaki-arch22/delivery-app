// What the QR codes contain (contract: PCK1 = the sender's pickup code, DLV1 = the receiver's delivery code).
// The driver's app reads them; the server checks the code. A QR for another order is refused here already.
export const pickupQr = (ref: string, code: string) => `PCK1:${ref}:${code}`;
export const deliveryQr = (ref: string, code: string) => `DLV1:${ref}:${code}`;
export function readQr(data: string, kind: 'PCK1' | 'DLV1', ref: string): { code: string } | { error: 'wrong_kind' | 'other_order' } {
  const m = /^(PCK1|DLV1):([A-Z0-9]{1,20}):(\d{4})$/.exec((data ?? '').trim());
  if (!m || m[1] !== kind) return { error: 'wrong_kind' };
  if (m[2] !== ref) return { error: 'other_order' };
  return { code: m[3] };
}
