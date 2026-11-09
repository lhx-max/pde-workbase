#!/usr/bin/env bash
# Build + package the canvas-coi Appwrite Function. This script performs NO
# remote mutation: Root executes the actual deployment, ACL/scope changes and
# cloud acceptance. Existing deployments are never overwritten implicitly.
set -euo pipefail
cd "$(dirname "$0")"
node ./esbuild.config.mjs
echo
echo "Packaged upload closure: .deploy/main.cjs + package.json + function.manifest.json + LICENSE"
echo "Operator deployment checklist (Root-owned, not run here):"
echo "  1. Provision private database/collections + bucket, runtime collection,"
echo "     and the state namespace manifest (initialize once, not per-deploy)."
echo "  2. Upload .deploy only, entrypoint main.cjs, runtime node-22 >= 22.13;"
echo "     sharp is installed by the platform build from package.json)."
echo "  3. Set required env from dist/function.manifest.json; do not change"
echo "     execute/scopes/ACL as a side effect of deployment."
echo "  4. Rollback: keep the previous deploymentId; activate it again if the"
echo "     new bundle fails acceptance. Writer-lock residue needs operator"
echo "     inspection, never automatic deletion."
