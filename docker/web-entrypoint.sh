#!/bin/bash
# Decide which database the site talks to, then hand off to Apache.
#  - If the remote DB_HOST from .env answers on :3306 → leave it; PHP uses .env.
#  - Otherwise export DB_* so PHP (getenv wins over .env) uses the local `db` service.
set -e
APP=/var/www/html

# Ensure a .env exists so cosmo_config() loads (falls back to the example).
if [ ! -f "$APP/.env" ] && [ -f "$APP/.env.example" ]; then
  cp "$APP/.env.example" "$APP/.env"
fi

RHOST=$(grep -E '^DB_HOST=' "$APP/.env" 2>/dev/null | head -1 | sed -E "s/^DB_HOST=//; s/[\"' \r]//g")
USE_LOCAL=1
if [ -n "$RHOST" ] && [ "$RHOST" != "localhost" ] && [ "$RHOST" != "127.0.0.1" ] && [ "$RHOST" != "db" ]; then
  echo "[entrypoint] probing remote DB_HOST=$RHOST:3306 ..."
  if timeout 3 bash -c "exec 3<>/dev/tcp/$RHOST/3306" 2>/dev/null; then
    echo "[entrypoint] remote DB reachable → using the .env database."
    USE_LOCAL=0
  else
    echo "[entrypoint] remote DB unreachable → using local docker MySQL."
  fi
fi

if [ "$USE_LOCAL" = "1" ]; then
  export DB_HOST=db DB_NAME=cosmo DB_USER=cosmo DB_PASS=cosmo
  echo "[entrypoint] waiting for local db:3306 ..."
  for _ in $(seq 1 40); do
    if timeout 2 bash -c "exec 3<>/dev/tcp/db/3306" 2>/dev/null; then echo "[entrypoint] local db is up."; break; fi
    sleep 1
  done
fi

exec "$@"
