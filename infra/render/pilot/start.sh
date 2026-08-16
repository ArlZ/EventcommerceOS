#!/bin/sh
set -eu

if [ "${RELEASE_COMMIT:-}" != "${RENDER_GIT_COMMIT:-}" ]; then
  echo "release SHA mismatch" >&2
  exit 42
fi

case "${RUNTIME_TARGET:-}" in
  cloud-api)
    exec node /app/dist/main.js
    ;;
  control-web)
    exec node /app/apps/control-web/server.js
    ;;
  *)
    echo "unsupported Render runtime target: ${RUNTIME_TARGET:-<unset>}" >&2
    exit 64
    ;;
esac
