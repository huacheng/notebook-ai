#!/usr/bin/env bash
# restart.sh — Restart notebook-ai server (ports 3000 + 3002)
# Usage: ./restart.sh [--prod]
#   --prod  Build and run production version
#   (default) Run development server with hot reload
set -euo pipefail

PROD_MODE=false
if [[ "${1:-}" == "--prod" ]]; then
  PROD_MODE=true
fi

PORTS="3000 3002"

echo "==> Stopping notebook-ai processes..."
for port in $PORTS; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "    Killing PIDs on port $port: $pids"
    echo "$pids" | xargs kill 2>/dev/null || true
  fi
done

sleep 2

# Force-kill anything still lingering
for port in $PORTS; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "    Force-killing PIDs on port $port: $pids"
    echo "$pids" | xargs kill -9 2>/dev/null || true
  fi
done

sleep 1

# Verify ports are free
for port in $PORTS; do
  if lsof -ti :"$port" >/dev/null 2>&1; then
    echo "ERROR: port $port still occupied!"
    lsof -i :"$port"
    exit 1
  fi
done
echo "==> Ports $PORTS are free."

cd "$(dirname "$0")"

# Load .env if present
if [ -f .env ]; then
  set -a; source .env; set +a
fi

# ── Auto-generate HTTPS cert with all local IPs ─────────────────────────────
CERT_DIR="packages/web"
CERT_FILE="$CERT_DIR/localhost.pem"
KEY_FILE="$CERT_DIR/localhost-key.pem"

# Collect all local IPs
ALL_IPS=$(hostname -I 2>/dev/null | tr ' ' '\n' | grep -v '^$' | sort -u)

# Check if cert needs regeneration (missing or doesn't include all IPs)
NEED_REGEN=false
if [ ! -f "$CERT_FILE" ] || [ ! -f "$KEY_FILE" ]; then
  NEED_REGEN=true
  echo "==> HTTPS certificate not found, generating..."
else
  # Check if current cert includes all local IPs
  CERT_INFO=$(openssl x509 -in "$CERT_FILE" -text -noout 2>/dev/null)
  for ip in $ALL_IPS; do
    if ! echo "$CERT_INFO" | grep -q "$ip"; then
      NEED_REGEN=true
      echo "==> HTTPS certificate missing IP $ip, regenerating..."
      break
    fi
  done
fi

if $NEED_REGEN; then
  SAN_ENTRIES="DNS:localhost,IP:127.0.0.1"
  for ip in $ALL_IPS; do
    SAN_ENTRIES="$SAN_ENTRIES,IP:$ip"
  done

  openssl req -x509 -newkey rsa:2048 \
    -keyout "$KEY_FILE" -out "$CERT_FILE" \
    -days 365 -nodes \
    -subj "/CN=localhost" \
    -addext "subjectAltName=$SAN_ENTRIES" \
    2>/dev/null

  echo "==> HTTPS certificate generated for: localhost 127.0.0.1 $ALL_IPS"
fi

if $PROD_MODE; then
  echo "==> Building production version..."
  pnpm run build

  echo "==> Starting production server..."
  # Backend serves API on 3002, frontend static files served by a simple server on 3000
  PORT=3002 NB_AUTH_TOKEN="${NB_AUTH_TOKEN:-test123}" nohup node packages/server/dist/index.js > /tmp/notebook-prod-backend.log 2>&1 &

  # Serve frontend static files (using npx serve or python)
  if command -v serve &>/dev/null; then
    nohup serve -s packages/web/dist -l 3000 --ssl-cert packages/web/localhost.pem --ssl-key packages/web/localhost-key.pem > /tmp/notebook-prod-frontend.log 2>&1 &
  else
    nohup npx serve -s packages/web/dist -l 3000 --ssl-cert packages/web/localhost.pem --ssl-key packages/web/localhost-key.pem > /tmp/notebook-prod-frontend.log 2>&1 &
  fi

  LOG_FILE="/tmp/notebook-prod-backend.log"
  MODE_MSG="Production"
else
  echo "==> Starting notebook-ai dev server..."
  PORT=3002 NB_AUTH_TOKEN="${NB_AUTH_TOKEN:-test123}" nohup pnpm dev > /tmp/notebook-dev.log 2>&1 &
  LOG_FILE="/tmp/notebook-dev.log"
  MODE_MSG="Development"
fi

# Wait for backend to be ready (up to 15s)
echo -n "==> Waiting for backend on :3002"
for i in $(seq 1 30); do
  if curl -sk --max-time 1 https://localhost:3000/api/auth/status >/dev/null 2>&1; then
    echo " OK"
    echo "==> notebook-ai ($MODE_MSG) is running.  Frontend: https://localhost:3000  Backend: :3002"
    exit 0
  fi
  echo -n "."
  sleep 0.5
done

echo " TIMEOUT"
echo "==> Startup logs:"
tail -20 "$LOG_FILE"
exit 1
