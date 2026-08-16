#!/usr/bin/env bash
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${HOSTINGER_ENV_FILE:-$DIR/.env}"
POSTGRES_IMAGE='postgres:16.14-alpine3.24@sha256:57c72fd2a128e416c7fcc499958864df5301e940bca0a56f58fddf30ffc07777'

fail() {
  echo "ERROR: $*" >&2
  exit 1
}

env_value() {
  local key="$1"
  sed -n "s/^${key}=//p" "$ENV_FILE" | tail -n 1 | tr -d '\r'
}

[[ -f "$ENV_FILE" ]] || fail "Missing $ENV_FILE"
command -v docker >/dev/null 2>&1 || fail "docker is required"
command -v sha256sum >/dev/null 2>&1 || fail "sha256sum is required"
command -v openssl >/dev/null 2>&1 || fail "openssl is required"

BACKUP_DIR="$(env_value HOSTINGER_BACKUP_DIR)"
BACKUP_DIR="${BACKUP_DIR:-/opt/event-commerce/backups}"
BACKUP="${1:-$(find "$BACKUP_DIR" -maxdepth 1 -type f -name 'event-commerce-cloud-*.dump' -print | sort | tail -n 1)}"
[[ -n "$BACKUP" && -f "$BACKUP" ]] || fail "No backup file found"
[[ -f "$BACKUP.sha256" ]] || fail "Missing checksum file $BACKUP.sha256"
(cd "$(dirname "$BACKUP")" && sha256sum -c "$(basename "$BACKUP").sha256") >/dev/null || fail "Backup checksum failed"

NAME="event-commerce-restore-check-$(date -u +%s)-$$"
RESTORE_PASSWORD="$(openssl rand -hex 16)"
cleanup() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker run -d --name "$NAME" -e POSTGRES_PASSWORD="$RESTORE_PASSWORD" "$POSTGRES_IMAGE" >/dev/null
for attempt in $(seq 1 30); do
  if docker exec "$NAME" pg_isready -U postgres >/dev/null 2>&1; then
    break
  fi
  [[ "$attempt" != "30" ]] || fail "Isolated restore PostgreSQL did not become ready"
  sleep 1
done

docker exec "$NAME" createdb -U postgres event_commerce_restore
docker cp "$BACKUP" "$NAME:/tmp/backup.dump" >/dev/null
docker exec "$NAME" pg_restore -U postgres -d event_commerce_restore /tmp/backup.dump
TABLE_COUNT="$(docker exec "$NAME" psql -U postgres -d event_commerce_restore -Atc "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname='public';")"
[[ "$TABLE_COUNT" =~ ^[0-9]+$ && "$TABLE_COUNT" -gt 0 ]] || fail "Restore completed but no public tables were found"

echo "PASS isolated restore check: $(basename "$BACKUP") public_tables=$TABLE_COUNT"
echo "This mechanical check does not by itself satisfy representative recovery sign-off; retain RPO/RTO and business fingerprint evidence separately."
