import { HttpException } from '@nestjs/common';
export const fail = (status: number, error: string, message: string) => new HttpException({ error, message }, status);
export const bad = (error: string, message: string) => fail(400, error, message);
export const PHONE = /^\+[0-9]{8,15}$/;
export const isInt = (v: any) => Number.isInteger(v);

export function point(p: any, name: string) {
  const lat = p?.lat, lng = p?.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number' || lat < -90 || lat > 90 || lng < -180 || lng > 180) throw bad('BAD_POINT', `${name} must be {lat, lng}`);
  return { lat, lng };
}
const ADDR_KEYS = ['street', 'commune', 'building', 'entrance', 'floor', 'apartment', 'landmark', 'notes'];
export function address(a: any, name: string) {
  if (!a || typeof a !== 'object') throw bad('BAD_ADDRESS', `${name} is required`);
  const out: Record<string, string> = {};
  for (const k of ADDR_KEYS) if (a[k] != null) {
    if (typeof a[k] !== 'string' || a[k].length > 200) throw bad('BAD_ADDRESS', `${name}.${k} must be text up to 200 characters`);
    if (a[k].trim()) out[k] = a[k].trim();
  }
  if (!out.street && !out.landmark) throw bad('BAD_ADDRESS', `${name} needs a street or a landmark`);
  return out;
}
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const uuid = (v: any, name: string) => { if (typeof v !== 'string' || !UUID.test(v)) throw bad('BAD_ID', `${name} must be an id`); return v; };
export const text = (v: any, name: string, min: number, max: number) => { const t = typeof v === 'string' ? v.trim() : ''; if (t.length < min || t.length > max) throw bad('BAD_TEXT', `${name} must be ${min} to ${max} characters`); return t; };
export const nat = (v: any, name: string) => { if (!Number.isInteger(v) || v < 0) throw bad('BAD_NUMBER', `${name} must be a whole number, 0 or more`); return v as number; };
