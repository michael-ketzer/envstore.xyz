# Managed keys

Envstore's optional, API-only managed-key service uses OpenBao Transit. It serves
backend applications; there is no browser key setup, recipient registration, or
new dashboard. It is disabled until all OpenBao settings are configured.

This is **not zero-knowledge storage**: envstore and OpenBao have authority to
unwrap data keys. The existing age-encrypted `.env` service retains its separate
zero-knowledge model. Managed-key credentials cannot access age storage, and
recipient-bound workspace tokens cannot access managed keys.

## Runtime contract

Use HTTPS and `Authorization: Bearer esmk_…`. JSON responses, including errors,
carry `Cache-Control: no-store`. Send `Content-Type: application/json`.
Both the proposal's `/v1/keys/...` paths and `/api/v1/keys/...` are supported.

### Generate

`POST /v1/keys/{keyId}/data-keys`

```json
{
  "context": {
    "purpose": "shinra-creator-briefing-v1",
    "teamId": "team-123",
    "campaignId": "campaign-456",
    "creatorId": "creator-789",
    "accessId": "assignment-012"
  }
}
```

```json
{
  "provider": "envstore-openbao-transit",
  "version": 1,
  "keyId": "6fd445c3-a7b2-48ea-93da-644a4c4b96a1",
  "plaintextKey": "<canonical base64 encoding of exactly 32 bytes>",
  "wrappedKey": "esmk1.openbao.<keyId>.<opaque payload>"
}
```

Every call generates a fresh 256-bit key. The application encrypts its briefing
locally with AES-256-GCM and stores its own ciphertext, nonce, tag, wrapped key,
key ID, provider, and envelope version. Briefing bodies never enter this API.

### Unwrap

`POST /v1/keys/{keyId}/data-keys/unwrap`

Send the same `context` plus `wrappedKey`. The response has `provider`, `version`,
`keyId`, and `plaintextKey` with the same encodings as generation.

Context has exactly purpose, teamId, campaignId, creatorId, and one of `accessId`
or `assignmentId`. Shinra's current provider uses `accessId`; `assignmentId` is
available to new integrations. These names are distinct cryptographic bindings:
you cannot rename a field on existing ciphertext. Field order does not matter.
Identifiers are 1–128 ASCII letters, numbers, periods, underscores, colons, or
hyphens, beginning with a letter or number. They must never contain names or
briefing text. All extra fields are rejected.

The team ID must equal the administrator-provisioned tenant ID, and the purpose
must equal the key's immutable purpose. Envstore additionally binds the workspace,
key ID, tenant, and environment into Transit derivation context. A caller-supplied
team ID alone grants nothing. Changing any binding makes unwrap fail.

Requests and engine responses are limited to 16 KiB; engine calls and body reads
have five-second timeouts. Error bodies never include upstream diagnostics.
Errors: 400 invalid input/context/ciphertext or insecure transport, 401 invalid,
expired or revoked credential, 403 unauthorized/unavailable key, 413 oversized
request, 415 wrong content type, 429 throttled, 503 unconfigured/unavailable
service or invalid engine response. A body read timeout returns 408.

Application adapters must impose their own timeout and response bounds, validate
the provider/version/key ID and base64 length, and fail without a plaintext
fallback. Clear byte buffers after encryption/decryption; never log plaintext
keys or persist them in caches, traces, crash reports, or error objects. JavaScript
strings and transport buffers cannot be reliably erased by this service.

For Shinra's `BriefingKeyProvider`, decode `plaintextKey` to a 32-byte buffer and
encode the opaque `wrappedKey` string as UTF-8 bytes. Reverse that UTF-8 encoding
on unwrap. Updating Shinra itself is a separate change: its existing AWS envelope
version must remain readable through the AWS provider. Introduce a distinct
provider/envelope version for new envstore records; do not reinterpret AWS-wrapped
bytes or silently change existing ciphertext's context.

## Administration

Use a **human CLI bearer token** belonging to an OWNER or ADMIN in the workspace.
Application and recipient-based workspace credentials cannot administer keys or
mint credentials. The base path is
`/api/v1/workspaces/{workspaceSlug}/managed-keys`.

| Method and suffix                    | Purpose                                                            |
| ------------------------------------ | ------------------------------------------------------------------ |
| `POST /`                             | Provision a key                                                    |
| `GET /`                              | List key metadata (up to 1,000 most recent)                        |
| `POST /{keyId}/rotate`               | Add a new write version, retaining all old read versions           |
| `POST /{keyId}/disable`              | Idempotently block future generation and unwrap                    |
| `POST /credentials`                  | Issue an application credential, returned once                     |
| `GET /credentials`                   | List credentials and grants (up to 1,000, never hashes or bearers) |
| `DELETE /credentials/{credentialId}` | Idempotently revoke a credential                                   |
| `GET /audit?limit=100&cursor=…`      | Read audit events (maximum 200 per page)                           |

Provisioning body:

```json
{
  "name": "creator-briefings",
  "tenantId": "team-123",
  "environment": "production",
  "purpose": "shinra-creator-briefing-v1"
}
```

The `(workspace, tenantId, environment, name)` tuple is the idempotency key.
Retries return the same key ID and resume incomplete engine provisioning.
A changed purpose or an already-disabled key returns 409; retries never re-enable
or replace keys. Key IDs are UUIDs allocated by envstore. Engine names are
`envstore-{keyId}`. The database stores metadata only, not wrapping-key material.

Credential body:

```json
{
  "applicationId": "shinra-backend",
  "tenantId": "team-123",
  "environment": "production",
  "expiresInDays": 90,
  "grants": [
    {
      "keyId": "6fd445c3-a7b2-48ea-93da-644a4c4b96a1",
      "operations": ["generate", "unwrap"]
    }
  ]
}
```

Credentials contain 256 random bits, stored SHA-256-hashed, and expire after
1–365 days (90 by default). Grants must be nonempty, explicit key IDs with
`generate` and/or `unwrap`; there are no wildcard grants. All keys must belong
to the credential's workspace, tenant, and environment. Each tenant/environment
requires its own credential. An application holding many tenant credentials
still has authority across those tenants. Provision separate keys for each
production/staging tenant. No implicit access follows from application IDs.

Credential issuance is deliberately not replayable: if the response is lost,
list and revoke the orphaned credential, then issue another. Rotation may add
another harmless version on a retry after an ambiguous network failure.
Disable/revoke affects future service access, including a recheck before key
responses, but cannot recall keys/plaintext already returned or eliminate every
in-flight response race. Disabling is an envstore authorization gate; operators
with direct OpenBao access retain authority. There is no re-enable or permanent
key deletion API in this version.

Audit records contain caller IDs, key ID (where applicable), operation, outcome,
and time. No context or key bytes are stored. An `attempted` event is persisted
before an authorized engine operation; terminal `success`, `denied`, or `error`
is required before returning material. A crash can leave `attempted` events.
A success means the operation completed, not proof that the client received it.
Unrecognized credentials have no caller/workspace attribution; operators can
review those records in the database. Workspace admins can read only their own
events. Audit persistence failure returns 503 without releasing key material.
Preflight failures and requests rejected by the rate limiter are not audited.

Soft-deleted workspaces cannot use the service. Workspaces with managed-key
metadata, credentials, or audit events are excluded from hard-deletion sweeps;
foreign keys also prevent accidental deletion. Restore the workspace to recover
access. Permanent deletion and audit-retention policies require separate design.

## OpenBao setup

1. Apply the database migration with `pnpm --filter @envstore/db migrate:deploy`.
2. Deploy a supported OpenBao instance, initialize/unseal it, and enable a dedicated Transit engine
   at the configured mount (do not share it with other services). Use HTTPS in production.
3. Give envstore separate runtime and administration tokens with the policies
   below. Root tokens are for bootstrap only and must not be configured in envstore.
4. Set `OPENBAO_URL`, `OPENBAO_TRANSIT_MOUNT` (default `transit`),
   `OPENBAO_RUNTIME_TOKEN`, and `OPENBAO_ADMIN_TOKEN` in the server secret store.
5. Restart envstore and provision each tenant/environment key through its API.

Runtime policy (replace `transit` if needed):

```hcl
path "transit/datakey/plaintext/envstore-*" {
  capabilities = ["update"]
}
path "transit/decrypt/envstore-*" {
  capabilities = ["update"]
}
```

Administration policy:

```hcl
path "transit/keys/+" {
  capabilities = ["create", "update", "read"]
}
path "transit/keys/+/rotate" {
  capabilities = ["update"]
}
```

No export, backup, key deletion, configuration changes, or decrypt permission is
needed by the admin token. Transit keys use derived AES-256-GCM with export and
plaintext backup disabled; the API verifies those settings on provisioning.
The implementation follows the [OpenBao Transit API](https://openbao.org/api-docs/secret/transit/).

Public runtime and administration requests require HTTPS. If TLS terminates at an
ingress and the application sees HTTP, set `MANAGED_KEYS_TRUST_PROXY=true` only
when that ingress overwrites `X-Forwarded-Proto` and direct application access is
blocked. No redirect is followed when contacting OpenBao. Loopback HTTP to
OpenBao is allowed only outside production for local tests.

Exclude these routes and OpenBao calls from body/header capture in proxies, APM,
tracing, error reporting, and caches. Keep OpenBao audit devices' sensitive-field
hashing enabled. The app has a per-process 120 requests/minute actor limit;
production ingress must also enforce distributed and unauthenticated limits.

The hosted installation is documented in [OpenBao operations](openbao-operations.md),
including automatic unsealing, token renewal, encrypted snapshots and recovery.
Self-hosted envstore deployments must operate their own OpenBao service and
exercise these procedures. The hosted media-server installation is a single node,
without HA/failover; choose availability and monitoring arrangements appropriate
to your deployment.
Restore **both** envstore metadata and the matching OpenBao key history. Never
raise minimum decryption versions or trim history while old envelopes exist.
A successful local smoke test is not a backup/restore or availability guarantee.

## Verification

Run `scripts/managed-keys/smoke.sh` with Docker and pnpm available. It creates
disposable loopback-only OpenBao 2.7.0 and PostgreSQL containers, applies all
migrations, installs the supplied least-privilege policies, and tests provisioning,
data-key round trips, old-key reads after rotation, context/tenant isolation,
revocation, disable, audit contents, and retention. It removes both containers
on exit and also runs in CI. These dev-mode services are never production setup.
