#!/usr/bin/env bash
# Encrypted nightly backup of the database (free tools only). The backup is useless to a thief without the key file.
# One-time: openssl rand -base64 48 > /root/backup.key && chmod 600 /root/backup.key   (keep a copy of the key OFF the server, e.g. in a password manager)
# Cron:     0 3 * * * /opt/delivery/deploy/backup.sh
set -euo pipefail
OUT=/var/backups/delivery; KEY=/root/backup.key; mkdir -p "$OUT"; chmod 700 "$OUT"
STAMP=$(date +%Y%m%d-%H%M)
pg_dump --format=custom "$OWNER_DATABASE_URL" | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -pass file:"$KEY" -out "$OUT/delivery-$STAMP.dump.enc"
find "$OUT" -name 'delivery-*.dump.enc' -mtime +14 -delete
echo "backup written: $OUT/delivery-$STAMP.dump.enc  (copy it to a SECOND place; test a restore regularly)"
# Restore:  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:/root/backup.key -in FILE.dump.enc | pg_restore -d NEWDB
