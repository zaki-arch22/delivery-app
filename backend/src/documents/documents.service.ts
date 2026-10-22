import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import sharp from 'sharp';
import { Db } from '../db/db.service';
import { SecurityLog } from '../security/security-log.service';
import { bad, fail, UUID } from '../common/errors';

export const KINDS = ['id_photo', 'licence_photo', 'ownership_photo', 'vehicle_photo'] as const;   // driver sign-up (all required; up to 3 more vehicle photos)
export type Kind = typeof KINDS[number];
export const ORDER_KINDS = ['parcel_photo', 'evidence_photo', 'transfer_receipt'] as const;       // tied to an order: parcel at pickup, evidence of a refusal or problem
export type OrderKind = typeof ORDER_KINDS[number];
const ALL_KINDS: readonly string[] = [...KINDS, ...ORDER_KINDS, 'selfie_photo'];   // transfer_receipt = a BaridiMob receipt (seller payment or wallet top-up)
export const MAX_UPLOAD_BYTES = 6 * 1024 * 1024;   // a phone photo; the server shrinks it anyway
const MAX_UNUSED = 10;          // uploaded but not yet used by a driver profile, per account (stops storage filling)
const MAX_SIDE = 2000;          // stored size: enough to read an ID card, small to store
sharp.cache(false);             // never keep decoded images in memory between requests

// What the first bytes of a file say it really is (never trust the name or the declared type).
function sniff(b: Buffer): 'jpeg' | 'png' | 'webp' | null {
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.length >= 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

// Driver document photos. Every picture is decoded and drawn again as a fresh JPEG: hidden data (location, camera details,
// anything appended or disguised as an image) is thrown away. Photos are kept in the private database (table document_files),
// never in a web folder, and shown only to logged-in staff (every view is written in the audit trail).
@Injectable()
export class Documents {
  private log = new Logger('Documents');
  constructor(private db: Db, private sec: SecurityLog) {}

  async upload(accountId: string, ip: string, kind: any, body: any) {
    if (!ALL_KINDS.includes(kind)) throw bad('BAD_KIND', 'kind must be id_photo, licence_photo, ownership_photo, vehicle_photo, parcel_photo, evidence_photo, selfie_photo or transfer_receipt');
    if (!Buffer.isBuffer(body) || body.length === 0) throw fail(415, 'IMAGE_ONLY', 'Send a JPEG, PNG or WebP photo');
    if (!sniff(body)) { this.sec.event('upload_not_image', ip, { kind }, { account: accountId }); throw fail(415, 'IMAGE_ONLY', 'Send a JPEG, PNG or WebP photo'); }
    const unused = await this.db.one(`SELECT count(*)::int n FROM documents WHERE account_id=$1 AND profile_id IS NULL AND order_id IS NULL`, [accountId]);
    if (unused.n >= MAX_UNUSED) { this.sec.event('upload_cap', ip, {}, { account: accountId }); throw fail(429, 'TOO_MANY_UPLOADS', 'Too many photos waiting. Finish the sign-up or try again tomorrow.'); }

    let out: Buffer, w = 0, h = 0;
    try {
      // limitInputPixels stops "decompression bombs" (a tiny file that expands into a giant picture).
      const img = sharp(body, { limitInputPixels: 40_000_000, failOn: 'error', sequentialRead: true });
      const meta = await img.metadata();
      if (!meta.width || !meta.height || (meta.pages ?? 1) > 1) throw new Error('not a single still picture');
      const r = await img.rotate().resize({ width: MAX_SIDE, height: MAX_SIDE, fit: 'inside', withoutEnlargement: true })
        .flatten({ background: '#ffffff' }).jpeg({ quality: 82 }).toBuffer({ resolveWithObject: true });
      out = r.data; w = r.info.width; h = r.info.height;
    } catch {
      this.sec.event('upload_bad_image', ip, { kind }, { account: accountId });
      throw bad('BAD_IMAGE', 'This photo could not be read. Take a new photo.');
    }
    // No automatic rejection for quality (owner's rule, Oct 2026): a person reviews every driver document.

    const id = randomUUID();
    await this.db.tx(async q => {
      await q(`INSERT INTO documents(id, account_id, kind, size_bytes, sha256) VALUES ($1,$2,$3,$4,$5)`,
        [id, accountId, kind, out.length, createHash('sha256').update(out).digest('hex')]);
      await q(`INSERT INTO document_files(document_id, data) VALUES ($1,$2)`, [id, out]);
    });
    return { document_id: id, kind };
  }

  // Inside the add_profile transaction: every photo must belong to this account, be of the right kind and unused.
  // `extra` = more vehicle photos (the plate must be readable on at least one; staff check).
  async attach(q: (sql: string, p?: any[]) => Promise<any[]>, accountId: string, profileId: string, docs: Record<Kind, string>, extra: string[] = []) {
    const ids = [...KINDS.map(k => docs[k]), ...extra];
    if (new Set(ids).size !== ids.length) throw bad('BAD_DOCUMENT', 'Each photo can be used once');
    const rows = await q(`SELECT id, kind FROM documents WHERE id = ANY($1::uuid[]) AND account_id=$2 AND profile_id IS NULL AND order_id IS NULL FOR UPDATE`, [ids, accountId]);
    for (const k of KINDS) if (!rows.some(r => r.id === docs[k] && r.kind === k)) throw bad('BAD_DOCUMENT', `${k} must be a photo you uploaded for this sign-up`);
    for (const x of extra) if (!rows.some(r => r.id === x && r.kind === 'vehicle_photo')) throw bad('BAD_DOCUMENT', 'Extra vehicle photos must be photos you uploaded for this sign-up');
    await q(`UPDATE documents SET profile_id=$1 WHERE id = ANY($2::uuid[])`, [profileId, ids]);
  }

  // Inside an order transaction: a parcel or evidence photo uploaded by THIS account, of the right kind, never used before.
  async attachToOrder(q: (sql: string, p?: any[]) => Promise<any[]>, accountId: string, orderId: string, docId: any, kind: OrderKind) {
    if (typeof docId !== 'string' || !UUID.test(docId)) throw bad('PHOTO_REQUIRED', `A ${kind.replace('_', ' ')} is required`);
    const [d] = await q(`UPDATE documents SET order_id=$3 WHERE id=$1 AND account_id=$2 AND kind=$4 AND profile_id IS NULL AND order_id IS NULL RETURNING id`, [docId, accountId, orderId, kind]);
    if (!d) throw bad('BAD_DOCUMENT', `The ${kind.replace('_', ' ')} must be one you just took for this order`);
    return d.id as string;
  }

  // A photo tied to an order, for the people of that order (the caller has already checked who may see it).
  async orderPhoto(orderId: string, docId: string | null): Promise<Buffer | null> {
    if (!docId) return null;
    const r = await this.db.one(`SELECT f.data FROM documents d JOIN document_files f ON f.document_id=d.id WHERE d.id=$1 AND d.order_id=$2`, [docId, orderId]);
    return r?.data ?? null;
  }

  // Staff only. Who looked at a photo is recorded forever.
  async readForStaff(staffId: string, id: any) {
    if (typeof id !== 'string' || !UUID.test(id)) throw bad('BAD_ID', 'id must be an id');
    const doc = await this.db.one(`SELECT d.id, d.kind, d.profile_id, d.order_id, f.data FROM documents d JOIN document_files f ON f.document_id=d.id WHERE d.id=$1 AND (d.profile_id IS NOT NULL OR d.order_id IS NOT NULL)`, [id]);
    if (!doc) throw fail(404, 'NOT_FOUND', 'Document not found');
    const data: Buffer = doc.data;
    await this.db.query(`INSERT INTO staff_audit(staff_id, action, target_type, target_id, data) VALUES ($1,'view_document',$2,$3,$4)`,
      [staffId, doc.profile_id ? 'profile' : 'order', doc.profile_id ?? doc.order_id, { document_id: doc.id, kind: doc.kind }]);
    return data;
  }

  // Hourly: photos uploaded but never used for a sign-up are deleted after a day (with their picture).
  async cleanup() {
    const old = await this.db.query(`DELETE FROM documents WHERE profile_id IS NULL AND order_id IS NULL AND created_at < now() - interval '1 day' RETURNING id`);
    return old.length;
  }
}
