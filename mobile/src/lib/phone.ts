// Algerian mobile numbers: 05/06/07 + 8 digits locally, +213 5/6/7 + 8 digits internationally.
// Accepts what people actually type (spaces, dashes, 0 prefix, 00213 or +213) and returns +213XXXXXXXXX, or null.
export function toInternational(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, '').replace(/^\+/, '00');
  if (!/^\d+$/.test(digits)) return null;
  let national: string;
  if (digits.startsWith('00213')) national = digits.slice(5);
  else if (digits.startsWith('213') && digits.length === 12) national = digits.slice(3);
  else if (digits.startsWith('0')) national = digits.slice(1);
  else national = digits;
  return /^[567]\d{8}$/.test(national) ? '+213' + national : null;
}
// +213550123456 -> 0550 12 34 56 (how people in Algeria write it)
export function display(intl: string): string {
  const n = intl.replace(/^\+213/, '0');
  return n.length === 10 ? `${n.slice(0, 4)} ${n.slice(4, 6)} ${n.slice(6, 8)} ${n.slice(8)}` : intl;
}
