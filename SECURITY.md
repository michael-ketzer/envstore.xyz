# Security policy

envstore stores secrets — security reports get priority.

## Reporting a vulnerability

**Email: security@envstore.xyz**

Please include:

- A description of the issue
- Steps to reproduce
- Your assessment of impact

**Do not open a public GitHub issue** for security reports.

We aim to:

- **Acknowledge** receipt within 72 hours
- **Triage and confirm** within 7 days
- **Ship a fix or mitigation** within 30 days for high-severity issues

If you'd like to disclose publicly afterwards, we'd love to credit you in the
release notes. Just tell us.

## In scope

- Authentication and authorization flows (OAuth, OTP, device-code, bearer
  tokens, workspace membership/role checks)
- The zero-knowledge guarantee — the server must not be able to access
  plaintext or private keys
- API endpoints under `/api/v1/*` and `/api/cli/*`
- CLI binaries
- Information leakage about workspaces, projects, or members to non-members

## Out of scope

- Social engineering / phishing attacks
- Physical attacks on a user's device
- Pure DoS / DDoS without amplification
- Attacks requiring the attacker to already control the user's machine — the
  age secret key lives there, so compromise of that machine compromises the
  user's data by design. This is the trade-off of zero-knowledge: there's no
  server-side recovery.

## Threat model

We assume:

- The server (Next.js app + Postgres + R2) can be fully compromised. An
  attacker with database + R2 access still cannot decrypt env files.
- The user's local machine is trusted. The age secret key, CLI bearer token,
  and any cached identity live there.
- Transport is HTTPS only. We set HSTS with `includeSubDomains; preload`.
- Bearer tokens are sensitive. They're stored hashed (sha256) in the DB and
  shown to the user exactly once on issuance. They're scoped to a single user
  and revocable from the dashboard.

We do **not** assume:

- Browser session compromise is recoverable. If a user's session is hijacked,
  the attacker has account access until the session expires or is revoked.
- Cross-machine identity recovery. If the user loses their machine and their
  identity backup, their encrypted data is unreadable forever.

## Cryptographic primitives

We deliberately use boring, audited cryptography:

- **[age](https://github.com/FiloSottile/age)** for end-to-end encryption:
  X25519 + ChaCha20-Poly1305-AEAD with HKDF-SHA-256. Audited.
- **SHA-256** for content hashes and secret-token storage hashes.
- **Web Crypto API** for SHA-256 on both server and client. Node-native on
  server, browser-provided otherwise.

If you find a weakness in our **use** of these primitives (key handling,
recipient validation, nonce reuse, etc.), please report. Weaknesses in age
itself should be reported [upstream](https://github.com/FiloSottile/age/security).

## What we already do

- Server stores ciphertext only — never plaintext, never private keys
- CLI tokens hashed (sha256) in DB; plaintext returned exactly once
- 1 MB ciphertext cap enforced at three layers (CLI, API, R2 presigned URL)
- Text-only enforcement at the CLI (git's NUL-byte + UTF-8 heuristic)
- Rate limiting on auth endpoints (OTP, device-code, link-code redeem)
- 365-day default CLI token TTL; per-user cap with oldest-revoked-first
- Strict security response headers (HSTS, X-Frame-Options, nosniff,
  Referrer-Policy, Permissions-Policy)
- Bearer auth on all `/api/v1/*` routes
- Workspace-membership gate on every cross-user resource
- Setup codes gated by workspace membership at redemption time (not single-use,
  membership IS the security boundary)

## Hall of fame

(Empty so far. Yours could go here.)
