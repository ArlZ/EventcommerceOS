#!/bin/sh
set -eu

if [ "${RELEASE_COMMIT:-}" != "${RENDER_GIT_COMMIT:-}" ]; then
  echo "release SHA mismatch" >&2
  exit 42
fi

if [ "${RUNTIME_TARGET:-}" != "cloud-api" ]; then
  echo "Render migrations are only valid for the cloud-api runtime" >&2
  exit 64
fi

exec node /app/scripts/migrate.mjs
