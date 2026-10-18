-- Decision: no SMS to recipients. SMS is used ONLY to verify a phone number at login (otp_codes).
DROP TABLE IF EXISTS sms_outbox;
