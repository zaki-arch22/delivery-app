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
    case 'GOOGLE_REJECTED': return { key: 'err_google' };
    case 'LOGIN_METHOD_OFF': return { key: 'login_none' };
    case 'PHONE_REQUIRED': return { key: 'contact_phone_sub' };
    case 'BAD_NAME': return { key: 'name_invalid' };
    case 'OFFER_GONE': case 'ORDER_TAKEN': return { key: 'offer_gone' };
    case 'ON_JOB': return { key: 'err_on_job' };
    case 'PROFILE_NOT_ACTIVE': return { key: 'err_not_active' };
    case 'CASH_MISMATCH': return { key: 'err_cash_mismatch' };
    case 'NOT_ONLINE': return { key: 'offline_now' };
    case 'QUOTE_EXPIRED': return { key: 'err_quote_expired' };
    case 'PRICE_OUT_OF_RANGE': case 'PRICE_NOT_ALLOWED': return { key: 'err_price_range' };
    case 'ZONE_CLOSED': return { key: 'zone_closed' };
    case 'TOO_FAR': return { key: 'too_far' };
    case 'ACTIVE_ORDER': return { key: 'err_delete_active_order' };
    case 'ACTIVE_JOB': return { key: 'err_delete_active_job' };
    case 'CASH_HELD': return { key: 'err_delete_cash' };
    case 'PAYOUT_ACCOUNT_REQUIRED': return { key: 'err_payout_required' };
    case 'BAD_RIP': return { key: 'payout_invalid' };
    case 'COD_TOO_HIGH': return { key: 'err_cod_too_high' };
    case 'REFERENCE_USED': return { key: 'err_reference_used' };
    case 'BAD_REFERENCE': return { key: 'settle_ref_invalid' };
    case 'PAYMENTS_OPEN': return { key: 'err_payments_open' };
    case 'CANNOT_DISPUTE': return { key: 'err_cannot_dispute' };
    case 'WALLET_NOT_OPEN': return { key: 'err_wallet_closed' };
    case 'ALREADY_SENT': case 'ALREADY_CLOSED': return { key: 'err_already_done' };
    case 'BAD_AMOUNT': return { key: 'wallet_amount_invalid' };
    case 'PRICING_NOT_SET': return { key: 'err_not_ready' };
    case 'CANNOT_CANCEL': return { key: 'err_cannot_cancel' };
    case 'PRICE_LOCKED': return { key: 'err_price_locked' };
    case 'ALREADY_RATED': return { key: 'err_already_rated' };
    case 'BAD_RECIPIENT': return { key: 'recipient_invalid' };
    case 'BAD_RECIPIENT_PHONE': return { key: 'phone_invalid' };
    case 'BAD_ADDRESS': return { key: 'address_needed' };
    case 'BAD_COD': return { key: 'cod_invalid' };
    case 'BAD_IMAGE': case 'IMAGE_ONLY': return { key: 'err_image_bad' };
    case 'IMAGE_TOO_SMALL': return { key: 'err_image_small' };
    case 'TOO_LARGE': return { key: 'err_image_large' };
    case 'TOO_MANY_UPLOADS': return { key: 'err_too_many_uploads' };
    case 'BAD_DOCUMENT': case 'DRIVER_DOCS_MISSING': return { key: 'err_bad_document' };
    case 'SESSION_ENDED': case 'BAD_TOKEN': return { key: 'err_session' };
    case 'PROFILE_BLOCKED': return { key: 'err_blocked' };
    case 'ACCOUNT_BANNED': return { key: 'banned' };
    case 'DEVICE_BANNED': return { key: 'err_device_banned' };
    case 'RULES_REQUIRED': return { key: 'rules_needed' };
    case 'BAD_NATIONAL_ID': return { key: 'nid_invalid' };
    case 'BAD_DRIVER_NAME': return { key: 'driver_name_missing' };
    case 'BAD_BIRTH_DATE': return { key: 'birth_invalid' };
    case 'BAD_VEHICLE_COLOR': return { key: 'colour_missing' };
    case 'BAD_PLATE': return { key: 'plate_invalid' };
    case 'ID_ALREADY_USED': return { key: 'err_nid_used' };
    case 'ID_BANNED': return { key: 'err_nid_banned' };
    case 'CANNOT_APPEAL': return { key: 'err_cannot_appeal' };
    default: return { key: 'err_generic' };
  }
}
