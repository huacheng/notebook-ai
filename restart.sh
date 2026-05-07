#!/usr/bin/env bash
# restart.sh — Restart notebook-ai server (ports 3003 + 4003)
# Usage: ./restart.sh [--dev]
#   --dev   Run development server with hot reload
#   (default) Build and run production version
set -euo pipefail

PROD_MODE=true
if [[ "${1:-}" == "--dev" ]]; then
  PROD_MODE=false
fi

PORTS="3003 4003"

echo "==> Stopping notebook-ai processes..."
for port in $PORTS; do
  pids=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$pids" ]; then
    echo "    Killing PIDs on port $port: $pids"
    echo "$pids" | xargs kill 2>/dev/null || true
  fi
done

# Kill orphaned Claude processes spawned by previous backend
claude_pids=$(pgrep -f "claude -p --input-format stream-json" 2>/dev/null || true)
if [ -n "$claude_pids" ]; then
  echo "    Killing orphaned Claude processes: $claude_pids"
  echo "$claude_pids" | xargs kill 2>/dev/null || true
fi

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

# Load environment variables from .env
if [ -f ".env" ]; then
  set -a
  source .env
  set +a
  echo "==> Loaded .env"
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
  # Backend serves both API and static files in production mode (single port 3003)
  NODE_ENV=production PORT=3003 nohup node packages/server/dist/index.js > /tmp/notebook-prod-v2.log 2>&1 &

  LOG_FILE="/tmp/notebook-prod-v2.log"
  MODE_MSG="Production"
else
  echo "==> Starting notebook-ai dev server..."
  PORT=4003 nohup pnpm dev > /tmp/notebook-dev.log 2>&1 &
  LOG_FILE="/tmp/notebook-dev.log"
  MODE_MSG="Development"
fi

# Wait for backend to be ready (up to 15s)
if $PROD_MODE; then
  WAIT_PORT=3003
  FINAL_MSG="==> notebook-ai ($MODE_MSG) is running.  URL: https://localhost:3003"
else
  WAIT_PORT=4003
  FINAL_MSG="==> notebook-ai ($MODE_MSG) is running.  Frontend: https://localhost:3003  Backend: :4003"
fi

echo -n "==> Waiting for backend on :$WAIT_PORT"
for i in $(seq 1 30); do
  if curl -sk --max-time 1 https://localhost:3003/api/auth/status >/dev/null 2>&1; then
    echo " OK"
    echo "$FINAL_MSG"
    exit 0
  fi
  echo -n "."
  sleep 0.5
done

echo " TIMEOUT"
echo "==> Startup logs:"
tail -20 "$LOG_FILE"
exit 1
