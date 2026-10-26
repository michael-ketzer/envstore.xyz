# Email

`apps/web` sends sign-in codes, workspace invitations, and optional inbound
forwards through Letterpier. All sending uses `src/lib/email.ts` and the
unmodified Resend SDK, pinned in the lockfile to Letterpier's tested 6.30.0
version. No provider call is made by the CLI or other packages.

| Variable                        | Purpose                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `LETTERPIER_API_KEY`            | Server-only project key. Use a live, full-access key for inbound forwarding and management. |
| `LETTERPIER_BASE_URL`           | `https://app.letterpier.com`; also the default.                                             |
| `LETTERPIER_FROM`               | `ENVStore <welcome@envstore.xyz>` for the hosted application.                               |
| `LETTERPIER_WEBHOOK_SECRET`     | Endpoint signing secret returned once by the management API.                                |
| `LETTERPIER_INBOUND_FORWARD_TO` | Existing forwarding recipient; unset disables inbound forwarding.                           |

Local Next.js and Prisma tooling load the root `.env.local`. Keep this file
ignored by Git and mode 0600. Development can use the terminal fallback when
email is unconfigured; production fails without logging codes or invite links.
API failures returned by the SDK propagate to callers. Provider error bodies
and inbound message contents must not be logged.

## Domain and DNS

The hosted sending domain is **envstore.xyz**. Preserve the display name and
`welcome` mailbox. Register the domain with a full-access project key via
`POST https://app.letterpier.com/domains`, and publish the **actual records
returned by that domain**, including its unique ownership token and DKIM key.
Do not copy example tokens or DKIM records from documentation.

Publish ownership TXT, DKIM TXT, the SPF include, and the return-path CNAME.
Retain the existing DMARC policy. If an SPF record already exists at a name,
merge `include:spf.letterpier.com` before its `all` term instead of creating a
second SPF record. Preserve the existing Resend DKIM and `send` subdomain
SPF/MX records until application inbox delivery is confirmed.

Receiving is used by this application's configured inbound forwarder. Create
the domain with `{"name":"envstore.xyz","receiving":true}` using HTTP: the
SDK's domain-create method does not transmit Letterpier's `receiving` field.
New sending-only domains should leave receiving off.

The hosted receiving MX is `mail.letterpier.com` at `envstore.xyz`, priority 10. The previous receiving route, `inbound-smtp.eu-west-1.amazonaws.com`, is
saved with its original priority in the private rollback DNS snapshot.
Preserve mailbox-provider MX records if migrating a domain with existing
mailboxes. Adding two equal priority receiving providers is not a reliable
migration strategy. Domain updates are dashboard-only in Letterpier; the
compatible API cannot change receiving after creation. Verify with
`domains.verify(id)` and confirm both the sending status and receiving
capability after the cutover.

## Webhook

The endpoint is
`https://www.envstore.xyz/api/letterpier/webhook`. Use the canonical `www`
host: Letterpier treats redirects as delivery failures. Subscribe to
`email.received`, the only event acted on by the application. Provision it
using `mail.webhooks.create({ endpoint, events: ['email.received'] })`, and
save the returned `signing_secret` as `LETTERPIER_WEBHOOK_SECRET` immediately.
Use the management API to provision the endpoint; no copied dashboard secret
is needed. Existing endpoints cannot be retrieved or updated through the
compatible API, but can be listed, deleted, and recreated.

The handler verifies the raw request body using the Svix-compatible HMAC
headers and a five-minute timestamp tolerance. It fetches the received body
and attachment bytes using `emails.receiving.get` and the receiving attachment
API. Incoming HTML is deliberately excluded from forwarded mail, Reply-To
is validated, and the existing recipient and metadata format are retained.
Attachment downloads never carry the API key.

Failures return 500 (or 503 when unconfigured), so Letterpier retries them.
Forwards use `inbound:<email_id>` as the send idempotency key, stable across
retries and replays. Letterpier's idempotency window is 24 hours; a replay
after that window can forward again. Sandbox receipts are acknowledged
without sending mail. Other signed events are acknowledged without action.

Letterpier has no native received-message forwarding endpoint, so forwarding
is implemented by re-sending through the central helper. Outbound limits
still apply: at most 20 attachments and about 10 MB total attachment content,
while received messages may reach about 14 MB. A forward exceeding those
limits fails and remains visible as a failed webhook; it is not silently
truncated. See the provider's [compatibility documentation](https://app.letterpier.com/docs/compatibility)
and [receiving guide](https://app.letterpier.com/docs/receiving).

## Release and rollback

Before modifying active settings, privately back up the local files,
encrypted envstore version, Vercel environment metadata, DNS, and production
deployment references. A Vercel sensitive value cannot be exported: preserve
its variable and deployment snapshot until its consumer has switched.

Audit project and shared team variables and every target, including custom
environments and branch overrides. Verify the Vercel Git repository and
`apps/web` root against this checkout. Store API keys and signing secrets as
Sensitive variables in Vercel production/preview and in the project's secret
store locally. Keep the Vercel API credential in a project-scoped secret
store for release tooling, rather than exposing it to client code.

Complete code, documentation, environment setup, domain verification, and
webhook provisioning before pushing to `main`. Run tests, typecheck, lint,
and the web build. With a missing live key, keep the work on a migration
branch and retain the existing production settings and deployment.

At cutover, remove active `RESEND_*` and obsolete SMTP variables only after
all consumers have migrated. Preserve old provider credentials/accounts,
DNS, endpoint configuration, and deployment snapshots for rollback. Deploy
the web app, check production health and rejection of invalid webhook
signatures, then check a locally signed non-receipt event against the live
endpoint without sending an email. Let the next real application email
confirm inbox delivery; do not send a standalone provider API test email.
