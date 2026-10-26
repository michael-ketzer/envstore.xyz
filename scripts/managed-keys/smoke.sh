#!/usr/bin/env bash
# Disposable integration test. Requires Docker, pnpm, and network access for images/Bun.
set -euo pipefail
cd "$(dirname "$0")/../.."
run_id="envstore-managed-keys-$$"
bao_container="$run_id-bao"
db_container="$run_id-db"
cleanup() {
  docker rm -f "$bao_container" "$db_container" >/dev/null 2>&1 || true
}
trap cleanup EXIT
# Loopback-only dev services with throwaway credentials; never use these in production.
docker run --detach --rm --name "$bao_container" -p 127.0.0.1::8200 \
  -e BAO_DEV_ROOT_TOKEN_ID=envstore-smoke-root \
  openbao/openbao:2.7.0@sha256:71156a1c6623a5fa3f5e61b0c6a8ead0faf0df29a778339188443551995d1315 \
  server -dev -dev-listen-address=0.0.0.0:8200 >/dev/null
docker run --detach --rm --name "$db_container" -p 127.0.0.1::5432 \
  -e POSTGRES_PASSWORD=envstore-smoke -e POSTGRES_DB=envstore postgres:17-alpine >/dev/null
for attempt in {1..30}; do
  if docker exec "$db_container" pg_isready -U postgres >/dev/null 2>&1 && \
     docker exec -e BAO_ADDR=http://127.0.0.1:8200 "$bao_container" bao status >/dev/null 2>&1; then break; fi
  sleep 1
done
bao() { docker exec -i -e BAO_ADDR=http://127.0.0.1:8200 -e BAO_TOKEN=envstore-smoke-root "$bao_container" bao "$@"; }
bao secrets enable transit >/dev/null
bao policy write envstore-runtime - < scripts/managed-keys/runtime-policy.hcl >/dev/null
bao policy write envstore-admin - < scripts/managed-keys/admin-policy.hcl >/dev/null
export OPENBAO_RUNTIME_TOKEN
OPENBAO_RUNTIME_TOKEN=$(bao token create -policy=envstore-runtime -field=token)
export OPENBAO_ADMIN_TOKEN
OPENBAO_ADMIN_TOKEN=$(bao token create -policy=envstore-admin -field=token)
export OPENBAO_URL="http://$(docker port "$bao_container" 8200)"
export OPENBAO_TRANSIT_MOUNT=transit
export DATABASE_URL="postgresql://postgres:envstore-smoke@$(docker port "$db_container" 5432)/envstore"
export DIRECT_URL="$DATABASE_URL"
export NODE_ENV=test
export AUTH_SECRET=envstore-smoke-only-secret-at-least-32-characters
export NEXT_PUBLIC_APP_URL=https://envstore.test
export MANAGED_KEYS_TRUST_PROXY=false
pnpm db:generate
pnpm --filter @envstore/db exec prisma migrate deploy
# Invoked independently to avoid unit-test module mocks replacing the real database.
(cd apps/web && pnpm dlx bun@1.3.14 run scripts/managed-keys-smoke.ts)
