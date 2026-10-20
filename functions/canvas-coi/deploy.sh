#!/usr/bin/env bash
# Deploy the canvas COI door to Appwrite Functions.
# Prereqs: appwrite-cf installed + `login-ks` done + run inside a dir with
# appwrite-cf.config.json (project context). Usage: ./deploy.sh /path/to/cf-project-dir
set -euo pipefail
FN_DIR="$(cd "$(dirname "$0")" && pwd)"
CF_DIR="${1:-.}"

cd "$FN_DIR"
node ./esbuild.config.mjs                 # → dist/main.js (CJS — the internal runtime rejects bundled ESM)
mkdir -p .deploy && cp dist/main.js .deploy/main.js && echo '{}' > .deploy/package.json

cd "$CF_DIR"
appwrite-cf functions create --function-id canvas-coi --name "Canvas COI" --runtime node-22 \
  --execute users --timeout 60 --entrypoint main.js --enabled true --logging true \
  --scopes databases.read databases.write collections.read collections.write attributes.read attributes.write \
          indexes.read indexes.write documents.read documents.write files.read files.write buckets.read buckets.write \
  2>/dev/null || true

DEP=$(appwrite-cf functions create-deployment --function-id canvas-coi --code "$FN_DIR/.deploy" \
      --activate true --entrypoint main.js | grep -o '"$id": "[^"]*"' | head -1 | cut -d'"' -f4)
echo "deployment: $DEP"
sleep 8
appwrite-cf functions update-function-deployment --function-id canvas-coi --deployment-id "$DEP" > /dev/null
echo "activated."

# Env vars (idempotent — create-variable fails on duplicates, that's fine):
for kv in \
  "APPWRITE_ENDPOINT|https://frontend-cloud.corp.kuaishou.com/v1" \
  "APPWRITE_PROJECT_ID|grworkspace" \
  "APPWRITE_DATABASE_ID|canvas_app_dev" \
  "APPWRITE_BUCKET_ID|canvas_assets_v2"; do
  appwrite-cf functions create-variable --function-id canvas-coi --key "${kv%%|*}" --value "${kv#*|}" 2>/dev/null || true
done
# APPWRITE_SESSION_COOKIE must be set manually for now (dev credential):
#   appwrite-cf functions create-variable --function-id canvas-coi --key APPWRITE_SESSION_COOKIE --value "<a_session_...>"
echo "Done. NOTE: function code prefers APPWRITE_FUNCTION_API_ENDPOINT (internal IDC endpoint) automatically."
