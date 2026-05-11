import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — envstore',
  description:
    'How envstore handles your data. Short version: the server stores ciphertext, never plaintext. You hold the keys.',
};

export default function PrivacyPolicyPage() {
  return (
    <>
      <h1>Privacy Policy</h1>
      <p className="lede">Last updated: 11 May 2026</p>

      <h2>The 30-second version</h2>
      <p>
        envstore is a zero-knowledge service. Your <code>.env</code> files are
        encrypted on your machine before they ever reach us. We store
        ciphertext, public keys, and the metadata required to bill you and
        operate the service. We never see plaintext secrets, never hold your
        private keys, and could not decrypt your data even if compelled.
      </p>

      <h2>Who's responsible</h2>
      <p>
        The data controller (in GDPR terms) is the operator listed in our{' '}
        <a href="/imprint">Imprint</a>. Reach us at{' '}
        <a href="mailto:privacy@envstore.xyz">privacy@envstore.xyz</a>.
      </p>

      <h2>What we collect</h2>

      <h3>Account data</h3>
      <ul>
        <li>
          <strong>Email address</strong>: required to sign in and contact you
          about your account.
        </li>
        <li>
          <strong>Name and avatar</strong>: optional, populated by your OAuth
          provider (GitHub or Google) if you sign in with one.
        </li>
        <li>
          <strong>Provider account ID</strong>: from GitHub or Google, used to
          recognise you across sign-ins.
        </li>
      </ul>

      <h3>Workspace and project data</h3>
      <ul>
        <li>Workspace, project, and environment names and slugs you create</li>
        <li>Membership and role information</li>
        <li>
          Encrypted env file ciphertext — opaque bytes that only your local
          private key can read
        </li>
        <li>Ciphertext metadata: size, SHA-256 checksum, version number, timestamps</li>
      </ul>

      <h3>Public encryption keys</h3>
      <p>
        Your age public recipient (e.g. <code>age1...</code>) is stored so other
        members can encrypt to you. Private keys never leave your machine.
      </p>

      <h3>Authentication tokens</h3>
      <ul>
        <li>
          Browser session cookies (signed JWT) issued by our authentication
          system
        </li>
        <li>
          CLI tokens (stored hashed via SHA-256 — we cannot recover the
          plaintext)
        </li>
      </ul>

      <h3>Operational logs</h3>
      <ul>
        <li>
          Audit log of mutating actions (who created what, when) for security
          and debugging
        </li>
        <li>
          Request IP addresses and user-agent strings, retained for up to 90
          days
        </li>
      </ul>

      <h3>Billing data</h3>
      <p>
        Billing is handled by our payment processor,{' '}
        <a href="https://www.paddle.com/" target="_blank" rel="noreferrer">
          Paddle
        </a>
        , which acts as the merchant of record. Paddle collects the data
        required to process payment (name, billing address, card details, tax
        ID where applicable). We receive only a subscription identifier and
        status from Paddle — we never see your full card number or CVC. See{' '}
        <a
          href="https://www.paddle.com/legal/privacy"
          target="_blank"
          rel="noreferrer"
        >
          Paddle's privacy notice
        </a>{' '}
        for details.
      </p>

      <h2>What we do NOT collect</h2>
      <ul>
        <li>
          <strong>Plaintext env file contents.</strong> Encryption happens
          locally. Ciphertext that reaches us is bound to your recipient(s)'
          public keys — we cannot decrypt it.
        </li>
        <li>
          <strong>Your age private key.</strong> It lives on your machine, in
          your OS keychain by default.
        </li>
        <li>
          <strong>Payment card details.</strong> Paddle handles these.
        </li>
      </ul>

      <h2>How we use your data</h2>
      <ul>
        <li>To provide the service you signed up for (Art. 6(1)(b) GDPR — contract)</li>
        <li>
          To bill you for paid workspaces (Art. 6(1)(b) — contract; handled via
          Paddle)
        </li>
        <li>
          To secure the service against abuse — rate limiting, audit logging,
          security investigations (Art. 6(1)(f) — legitimate interest)
        </li>
        <li>
          To send service emails (sign-in codes, invites, billing receipts —
          Art. 6(1)(b))
        </li>
      </ul>
      <p>
        We do not use your data for advertising, do not sell it, and do not
        share it with third parties beyond the processors listed below.
      </p>

      <h2>Subprocessors</h2>
      <ul>
        <li>
          <a href="https://neon.tech" target="_blank" rel="noreferrer">
            Neon
          </a>{' '}
          (Postgres database hosting)
        </li>
        <li>
          <a
            href="https://www.cloudflare.com/products/r2/"
            target="_blank"
            rel="noreferrer"
          >
            Cloudflare R2
          </a>{' '}
          (encrypted ciphertext storage)
        </li>
        <li>
          <a href="https://resend.com" target="_blank" rel="noreferrer">
            Resend
          </a>{' '}
          (transactional emails — sign-in codes, invites)
        </li>
        <li>
          <a href="https://www.paddle.com" target="_blank" rel="noreferrer">
            Paddle
          </a>{' '}
          (billing, merchant of record)
        </li>
        <li>
          <a href="https://vercel.com" target="_blank" rel="noreferrer">
            Vercel
          </a>{' '}
          (web hosting and CDN — for the dashboard)
        </li>
        <li>
          OAuth providers (
          <a href="https://github.com" target="_blank" rel="noreferrer">
            GitHub
          </a>
          ,{' '}
          <a href="https://google.com" target="_blank" rel="noreferrer">
            Google
          </a>
          ) — only if you sign in through them
        </li>
      </ul>

      <h2>Data location</h2>
      <p>
        Neon and Vercel infrastructure is selected at deployment time. R2
        objects are stored in the bucket region the operator configured (the
        EU jurisdiction is supported for EU-resident customers). Email is sent
        through Resend, which operates globally.
      </p>

      <h2>Retention</h2>
      <ul>
        <li>
          Account data: kept as long as your account is active. Deletion on
          request removes it within 30 days.
        </li>
        <li>
          Environment ciphertext: kept until you delete the project / environment.
          Soft-deleted resources are retained for the workspace's configured
          retention window (default 30 days) before permanent removal.
        </li>
        <li>Audit logs: 12 months, then aggregated or deleted.</li>
        <li>IP/user-agent logs: up to 90 days.</li>
        <li>Billing records: retained as long as required by tax law (typically 10 years in the EU).</li>
      </ul>

      <h2>Your rights (GDPR)</h2>
      <p>You have the right to:</p>
      <ul>
        <li>Access the data we hold about you</li>
        <li>Correct inaccurate data</li>
        <li>Delete your account and associated data ("right to be forgotten")</li>
        <li>Export your data in a machine-readable format (portability)</li>
        <li>Object to processing based on legitimate interest</li>
        <li>Withdraw consent where processing is based on consent</li>
        <li>
          Lodge a complaint with your supervisory authority (e.g. the German
          BfDI or your local DPA)
        </li>
      </ul>
      <p>
        Email <a href="mailto:privacy@envstore.xyz">privacy@envstore.xyz</a>{' '}
        to exercise any of these rights. We aim to respond within 30 days.
      </p>

      <h2>Cookies</h2>
      <p>
        We use only essential cookies — the session cookie that keeps you
        signed in, and CSRF tokens for form security. We don't run analytics
        tracking, advertising pixels, or any third-party cookies on our own
        pages.
      </p>

      <h2>Security</h2>
      <p>
        End-to-end encryption with{' '}
        <a href="https://github.com/FiloSottile/age" target="_blank" rel="noreferrer">
          age
        </a>{' '}
        (X25519 + ChaCha20-Poly1305). Transport over HTTPS. CLI tokens stored
        as SHA-256 hashes. Bearer tokens scoped per user, revocable from the
        dashboard, with a default 365-day TTL. Rate limiting on authentication
        endpoints. Strict response headers including HSTS, X-Frame-Options,
        Referrer-Policy, and Permissions-Policy. The source code is open and
        auditable: <a href="https://github.com/michael-ketzer/envstore.xyz" target="_blank" rel="noreferrer">github.com/michael-ketzer/envstore.xyz</a>.
      </p>
      <p>
        Found something concerning? See our{' '}
        <a
          href="https://github.com/michael-ketzer/envstore.xyz/blob/main/SECURITY.md"
          target="_blank"
          rel="noreferrer"
        >
          security policy
        </a>{' '}
        — email <a href="mailto:security@envstore.xyz">security@envstore.xyz</a>.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We'll post material changes at this page and, if the change is
        significant, email everyone with an active account at least 14 days
        before it takes effect.
      </p>

      <h2>Contact</h2>
      <p>
        Privacy questions: <a href="mailto:privacy@envstore.xyz">privacy@envstore.xyz</a>
        <br />
        Operator details: <a href="/imprint">Imprint</a>
      </p>
    </>
  );
}
