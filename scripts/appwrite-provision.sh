#!/usr/bin/env bash
# Provision the Canvas App resources on the internal Appwrite instance.
# Usage: ./scripts/appwrite-provision.sh [DATABASE_ID] [BUCKET_ID]
# Run inside a directory containing appwrite-cf.config.json (project context).
set -euo pipefail
DB="${1:-canvas_app_dev}"
BUCKET="${2:-canvas_assets_v2}"
PERMS=('read("users")' 'create("users")' 'update("users")' 'delete("users")')
MAX_SIZE=16777215   # MEDIUMTEXT for journal/snapshot blobs
BIG=4294967295      # not accepted on this instance; use 16MB attributes instead

appwrite-cf databases create --database-id "$DB" --name "Canvas App" || true

appwrite-cf databases create-collection --database-id "$DB" --collection-id canvases --name "Canvases" --document-security false --permissions "${PERMS[@]}" || true
appwrite-cf databases create-integer-attribute --database-id "$DB" --collection-id canvases --key revision --required true --min 0 || true
appwrite-cf databases create-string-attribute  --database-id "$DB" --collection-id canvases --key state      --size $MAX_SIZE --required true || true
appwrite-cf databases create-string-attribute  --database-id "$DB" --collection-id canvases --key operations --size $MAX_SIZE --required false || true
appwrite-cf databases create-string-attribute  --database-id "$DB" --collection-id canvases --key snapshots  --size $MAX_SIZE --required false || true
appwrite-cf databases create-string-attribute  --database-id "$DB" --collection-id canvases --key extra      --size $MAX_SIZE --required false || true

appwrite-cf databases create-collection --database-id "$DB" --collection-id canvas_operations --name "Canvas Operations" --document-security false --permissions "${PERMS[@]}" || true
for attr in canvasId operationId fingerprint receipt before after; do
  appwrite-cf databases create-string-attribute --database-id "$DB" --collection-id canvas_operations --key "$attr" --size $MAX_SIZE --required true || true
done
appwrite-cf databases create-index --database-id "$DB" --collection-id canvas_operations --key canvas_op_unique --type unique --attributes canvasId operationId || true

appwrite-cf databases create-collection --database-id "$DB" --collection-id canvas_files --name "Canvas Files" --document-security false --permissions "${PERMS[@]}" || true
for attr in path fileId kind mime sha256 createdAt; do
  appwrite-cf databases create-string-attribute --database-id "$DB" --collection-id canvas_files --key "$attr" --size 2000 --required true || true
done
appwrite-cf databases create-integer-attribute --database-id "$DB" --collection-id canvas_files --key size --required true --min 0 || true
appwrite-cf databases create-index --database-id "$DB" --collection-id canvas_files --key canvas_path_unique --type unique --attributes canvasId path || true
appwrite-cf databases create-index --database-id "$DB" --collection-id canvas_files --key canvas_id_idx --type key --attributes canvasId || true

appwrite-cf databases create-collection --database-id "$DB" --collection-id card_packs --name "Card Packs" --document-security false --permissions "${PERMS[@]}" || true
for attr in packId team name version renderEntry status updatedAt; do
  appwrite-cf databases create-string-attribute --database-id "$DB" --collection-id card_packs --key "$attr" --size 2000 --required true || true
done
for attr in kinds ops; do
  appwrite-cf databases create-string-attribute --database-id "$DB" --collection-id card_packs --key "$attr" --size $MAX_SIZE --required true || true
done

appwrite-cf databases create-collection --database-id "$DB" --collection-id card_grants --name "Card Grants" --document-security false --permissions "${PERMS[@]}" || true
for attr in scope source updatedAt; do
  appwrite-cf databases create-string-attribute --database-id "$DB" --collection-id card_grants --key "$attr" --size 2000 --required true || true
done
appwrite-cf databases create-string-attribute --database-id "$DB" --collection-id card_grants --key allowedKinds --size $MAX_SIZE --required true || true

# NOTE: the internal instance intermittently half-creates buckets (returns an
# empty object and uploads 500). If uploads fail, delete the bucket in the
# console and re-run with a fresh BUCKET id — canvas_assets was a casualty.
appwrite-cf storage create-bucket --bucket-id "$BUCKET" --name "Canvas Assets" --file-security false --maximum-file-size 30000000 --encryption false --antivirus false --permissions "${PERMS[@]}" || true

echo "Done: db=$DB bucket=$BUCKET"
