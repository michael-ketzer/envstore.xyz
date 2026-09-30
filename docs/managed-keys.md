# Managed keys

Envstore's optional managed-key service uses OpenBao Transit. It serves backend
applications and is disabled until all OpenBao settings are configured. Workspace
owners and admins register applications from the dashboard's **Encryption** page
or through the administration API. Data-key generation and unwrap remain backend
API operations; no plaintext encryption keys are delivered to the dashboard.

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

New integrations can use generic context v2:

```json
{
  "purpose": "vetdocs-umk-v1",
  "tenantId": "0199a0e0-0000-7000-8000-000000000001",
  "subjectId": "umk:1"
}
```

`purpose` and `tenantId` are required; `subjectId` is optional. Vetdocs uses its
user ID as the tenant and `umk:<version>` as the subject. The original context v1
has exactly purpose, teamId, campaignId, creatorId, and one of `accessId` or
`assignmentId`. Shinra's provider uses `accessId`. Both formats are strict: extra
fields and mixed v1/v2 fields are rejected. These names are distinct cryptographic
bindings: you cannot rename a field on existing ciphertext. Field order does not matter.
Identifiers are 1–128 ASCII letters, numbers, periods, underscores, colons, or
hyphens, beginning with a letter or number. They must never contain names or
briefing text. All extra fields are rejected.

The context's tenant ID (`tenantId` in v2, `teamId` in v1) must equal the
administrator-provisioned tenant ID, and the purpose
must equal the key's immutable purpose. Envstore additionally binds the workspace,
key ID, tenant, and environment into Transit derivation context. Generic contexts
use the `envstore-managed-key-v2` derivation namespace; legacy contexts retain
their exact v1 derivation bytes. The response provider, envelope version `1`, and
`esmk1.openbao.…` wrapped-key format are unchanged. A caller-supplied tenant ID
alone grants nothing. Changing any binding makes unwrap fail.

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

## Applications

A backend that serves many tenants registers once per environment instead of
holding one credential per tenant. An application:

- **Authenticates** as a Vercel deployment (OIDC, nothing stored) or with one
  static `esma_…` token for callers outside Vercel. A Vercel application is bound
  to the token's immutable team ID (`owner_id`), project ID (`project_id`), and
  deployment environment (`environment`) claims, never to renameable names.
- **Acts for every tenant** of one key `purpose` in one envstore `environment`,
  using keys named `keyName`. The tenant is `context.tenantId` for generic contexts
  and `context.teamId` for legacy contexts.
- **Creates a tenant's key on first use.** `generate` provisions a missing key
  with the same fixed Transit settings as administrator provisioning, up to
  `maxTenants` keys per environment and key name. It never replaces, re-enables,
  or re-purposes a key, and unwrap never creates one. Keys an administrator
  provisioned with the same environment, name, and purpose are used as they are,
  so envelopes created with tenant credentials stay readable.

An application has authority across all tenants in its scope, as an application
holding every tenant credential would. Disable one tenant's key to cut that
tenant off; revoke the application to stop all access.

### Application runtime

`POST /api/v1/workspaces/{workspaceSlug}/data-keys` takes `{ "context": … }` and
returns the same response as credential generation, including the tenant's
`keyId`. Store it with the envelope.

`POST /api/v1/workspaces/{workspaceSlug}/data-keys/unwrap` takes `context`,
`keyId`, and `wrappedKey`.

On Vercel, enable "Secure backend access with OIDC federation" in the project's
security settings and send a token minted for this installation:

```ts
import { getVercelOidcToken } from '@vercel/oidc';

const token = await getVercelOidcToken({ audience: 'https://www.envstore.xyz' });
```

The audience is `MANAGED_KEYS_AUDIENCE`, defaulting to the origin of
`NEXT_PUBLIC_APP_URL`. Tokens with Vercel's default audience are refused, so a
token issued to another service cannot be replayed here. Tokens are verified
against Vercel's published key set (`https://oidc.vercel.com/.well-known/jwks`,
RS256 only) with 30 seconds of clock tolerance and a 12-hour maximum age. Team
and global issuer modes both work.

- Vercel tokens name the environment, not the git branch: every preview
  deployment of a project shares preview access. Give previews their own
  envstore environment so they never reach production keys.
- Development tokens (`vercel env pull`, valid 12 hours) are available to every
  member of the Vercel team. Register a development application only for
  development keys.
- Each application has a budget of 1,200 requests per minute, and 120 per tenant,
  per process, in addition to the ingress limits below.

### Registering applications

In the dashboard, open a workspace and select **Encryption**
(`/dashboard/{workspaceSlug}/settings/applications`). Owners and admins can
register applications, see their scope and expiry, and revoke access. Static
tokens are shown once after registration and never appear in the application
list. The Vetdocs preset fills in `purpose=vetdocs-umk-v1` and `keyName=umk`.

For Vetdocs' current token adapter, select **Application token** and save the
configuration shown after registration in its backend environment secrets:

```sh
KEY_PROVIDER=envstore
ENVSTORE_URL=https://www.envstore.xyz
ENVSTORE_WORKSPACE=<actual-workspace-slug>
ENVSTORE_TOKEN=<esma-token-shown-once>
```

`ENVSTORE_WORKSPACE` is the workspace's actual slug; the dashboard resolves the
personal-workspace URL alias `me` before producing this configuration. Register
separate applications for production, staging, and development. Vetdocs' current
adapter reads a static token; using Vercel OIDC also requires an OIDC-aware adapter.

Vetdocs' current `Keyring` defaults to `localEscrow`, a filesystem store restricted
to explicit local development. Its hosted first-user provisioning also needs an
external durable `EscrowStore` and `ESCROW_RECIPIENT` configured in Vetdocs. Setting
the four envstore variables above connects its key provider; it does not configure
that separate escrow store.

Workspace administrators (see [Administration](#administration)) register with
`POST /api/v1/workspaces/{workspaceSlug}/managed-keys/applications`:

```json
{
  "name": "shinra-production",
  "environment": "production",
  "purpose": "shinra-creator-briefing-v1",
  "keyName": "creator-briefings",
  "maxTenants": 1000,
  "vercel": {
    "teamId": "team_…",
    "projectId": "prj_…",
    "environment": "production"
  }
}
```

For a static token, replace `vercel` with `"token": { "expiresInDays": 30 }`
(1–365 days, 90 by default). The token is returned once and stored hashed.
Names are unique per workspace. Registering the same Vercel deployment again is
idempotent and may change only `maxTenants`; any other change conflicts (revoke
and register a new name). A deployment has at most one active application per
purpose.

Applications with the same workspace, environment, `keyName`, and purpose share
the same tenant keys, allowing a web backend and a Worker to unwrap the same
envelopes with separate credentials. `maxTenants` counts the whole key space
(workspace, environment, key name), so use the same limit for such applications.

## Administration

Use a **human CLI bearer token** belonging to an OWNER or ADMIN in the workspace
for the administration API. The dashboard uses the signed-in human session with
the same role gate and durable managed-key auditing for registration and revocation.
Application credentials and tokens, Vercel deployments, and recipient-based
workspace credentials cannot administer keys or mint credentials. The base path is
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
| `POST /applications`                 | Register an application (a static token is returned once)          |
| `GET /applications`                  | List applications (up to 1,000, never token hashes)                |
| `DELETE /applications/{id}`          | Idempotently revoke an application                                 |
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
Backends serving many tenants should register an [application](#applications)
instead.

Credential issuance is deliberately not replayable: if the response is lost,
list and revoke the orphaned credential, then issue another. Rotation may add
another harmless version on a retry after an ambiguous network failure.
Disable/revoke affects future service access, including a recheck before key
responses, but cannot recall keys/plaintext already returned or eliminate every
in-flight response race. Disabling is an envstore authorization gate; operators
with direct OpenBao access retain authority. There is no re-enable or permanent
key deletion API in this version.

Audit records contain caller IDs (user, credential, or application), key ID
(where applicable), operation, outcome, and time. Keys created by an application
leave a `key.provision` event with its ID. No context or key bytes are stored. An `attempted` event is persisted
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
   Applications' first-use key creation uses the administration token for key
   creation only, with the same fixed settings.
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
