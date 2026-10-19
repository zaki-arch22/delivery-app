import { ApiError } from '../core/api';
import type { Key } from '../i18n';

// Turns a server or network error into a calm, translated message (contract section J).
export function errorMessage(e: unknown): { key: Key; vars?: Record<string, number> } {
  if (!(e instanceof ApiError)) return { key: 'err_generic' };
  switch (e.code) {
    case 'NETWORK': return { key: 'err_network' };
    case 'RATE_LIMITED': case 'SERVICE_BUSY': return { key: 'err_busy', vars: { s: Math.max(1, e.retryAfterS || 30) } };
    case 'TOO_MANY_CODES': return { key: 'err_too_many_codes' };
    case 'SMS_UNAVAILABLE': return { key: 'err_sms' };
    case 'CODE_WRONG': return { key: 'err_code_wrong' };
    case 'CODE_EXPIRED': case 'CODE_LOCKED': return { key: 'err_code_expired' };
    case 'BAD_PHONE': return { key: 'phone_invalid' };
    case 'BAD_NAME': return { key: 'name_invalid' };
    case 'BAD_IMAGE': case 'IMAGE_ONLY': return { key: 'err_image_bad' };
    case 'IMAGE_TOO_SMALL': return { key: 'err_image_small' };
    case 'TOO_LARGE': return { key: 'err_image_large' };
    case 'TOO_MANY_UPLOADS': return { key: 'err_too_many_uploads' };
    case 'BAD_DOCUMENT': case 'DRIVER_DOCS_MISSING': return { key: 'err_bad_document' };
    case 'SESSION_ENDED': case 'BAD_TOKEN': return { key: 'err_session' };
    default: return { key: 'err_generic' };
  }
}
