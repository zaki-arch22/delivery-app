-- English joins Arabic and French as an app language. Used for the language of push notifications.
ALTER TABLE device_tokens DROP CONSTRAINT device_tokens_language_check;
ALTER TABLE device_tokens ADD CONSTRAINT device_tokens_language_check CHECK (language IN ('ar','fr','en'));
