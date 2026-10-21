#!/bin/bash
# Start the full local stack detached from any terminal session.
# Usage: bash scripts/dev-services.sh
# Safe to re-run — listeners already bound are skipped.
set -u
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"

CANVAS_WS="$HOME/Desktop/canvas-workspace"
DOC_APP="$HOME/Desktop/designai-app-doc"

up() { lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1; }

if ! up 17462; then
  (cd "$CANVAS_WS/apps/server" && \
    CANVAS_DATA_DIR="$HOME/Desktop/canvas-data" \
    CANVAS_WEB_URL=http://127.0.0.1:17580 \
    nohup node dist/cli.js serve --hostname 127.0.0.1 --port 17462 </dev/null >/tmp/canvas-server-17462.log 2>&1 &)
  echo "canvas-server starting on 17462"
fi

if ! up 19000; then
  (cd "$DOC_APP/apps/server" && \
    DOC_REGISTER_TO=http://127.0.0.1:17462 \
    CANVAS_ORIGIN=http://127.0.0.1:17462 \
    DOC_PUBLIC_WEB_ORIGIN=http://127.0.0.1:19001 \
    DOC_DATA_DIR=/tmp/doc-app-data \
    nohup node dist/index.js </dev/null >/tmp/doc-19000.log 2>&1 &)
  echo "doc-server starting on 19000"
fi

if ! up 19001; then
  (cd "$DOC_APP/apps/web" && nohup node node_modules/vite/bin/vite.js --port 19001 </dev/null >/tmp/doc-web-19001.log 2>&1 &)
  echo "doc-web starting on 19001"
fi

if ! up 17580; then
  (cd "$CANVAS_WS/apps/web" && \
    CANVAS_SERVER_ORIGIN=http://127.0.0.1:17462 \
    CANVAS_WEB_URL=http://127.0.0.1:17580 \
    nohup node node_modules/next/dist/bin/next dev --port 17580 </dev/null >/tmp/canvas-web-17580.log 2>&1 &)
  echo "canvas-web starting on 17580"
fi

sleep 8
for p in 17462 17580 19000 19001; do
  code=$(curl -s -o /dev/null -w "%{http_code}" -m 20 "http://127.0.0.1:$p/" 2>/dev/null || echo "000")
  echo "port $p -> $code"
done
