import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Security & threat model — envstore',
  description:
    'What envstore can and cannot see, what an attacker can and cannot do, and how we minimize the blast radius if something goes wrong.',
};

export default function SecurityPage() {
  return (
    <>
      <h1>Security &amp; threat model</h1>
      <p className="lede">Last updated: 11 May 2026</p>

      <p>
        envstore is a zero-knowledge service. The TL;DR is that the server
        stores ciphertext and metadata; the keys that decrypt your data live on
        your laptop and your CI runners. This page is the long version — what
        we can and cannot see, what an attacker with various footholds can and
        cannot do, and how we shrink the blast radius when things go wrong.
      </p>

      <h2>What the server stores, in plain language</h2>
      <ul>
        <li>
          <strong>Ciphertext</strong> for every pushed version of every{' '}
          <code>.env</code> file. Stored in Cloudflare R2 (object storage),
          referenced from Postgres by a stable key.
        </li>
        <li>
          <strong>Public recipients</strong>: the public half of each user's
          age keypair, plus the public half of every workspace service token's
          keypair. These are the keys we encrypt to on push. We never see the
          private halves.
        </li>
        <li>
          <strong>Metadata</strong>: workspace, project, group, environment,
          and version rows; their slugs and names; soft-delete timestamps and
          retention settings; member roles; invite tokens; bearer-token{' '}
          <em>hashes</em> (sha256, never the cleartext).
        </li>
        <li>
          <strong>Audit log</strong>: who did what, when. Actor, action,
          resource. No IP addresses, no User-Agent strings.
        </li>
        <li>
          <strong>Billing</strong>: subscription state mirrored from Paddle.
          Card data lives at Paddle, not here.
        </li>
      </ul>

      <h2>What the server CANNOT see</h2>
      <ul>
        <li>
          <strong>The contents of your <code>.env</code> files.</strong>{' '}
          Plaintext never leaves the CLI process. Even if our entire database
          and object store were exfiltrated, an attacker would have ciphertext
          but no key.
        </li>
        <li>
          <strong>Your age private keys.</strong> They're generated locally
          (CLI <code>identity init</code> and <code>token create</code>) and
          stored in your OS Keychain or on disk at mode 0600. They never touch
          our wire and never enter the browser — the dashboard does not
          decrypt anything.
        </li>
        <li>
          <strong>Plaintext bearer tokens.</strong> Only sha256 hashes are
          stored. Stolen DB dumps don't yield working tokens.
        </li>
      </ul>

      <h2>Cryptographic primitives</h2>
      <p>
        We use age's hybrid encryption: X25519 for the per-recipient key wrap,
        ChaCha20-Poly1305 for the payload. Each push generates a fresh data
        key, wraps it once per recipient, and the resulting binary is what
        lands in R2.
      </p>
      <p>
        We use age the protocol — not the trademark. age is a BSD-3-licensed
        format and library by Filippo Valsorda; we link to{' '}
        <a href="https://age-encryption.org/" target="_blank" rel="noreferrer">
          age-encryption.org
        </a>{' '}
        for attribution and don't claim affiliation.
      </p>

      <h2>What an attacker can and cannot do</h2>

      <h3>If they exfiltrate our database</h3>
      <p>
        They get ciphertext, public keys, metadata, hashed bearers. They{' '}
        <strong>cannot</strong> decrypt any <code>.env</code> file. They cannot
        impersonate a user or a service token (the hashes are one-way). They
        cannot move money — billing lives at Paddle.
      </p>

      <h3>If they exfiltrate our object storage (R2 bucket)</h3>
      <p>
        Same outcome: ciphertext without keys. R2 access keys can list and
        read every object in the bucket, but every object is encrypted to
        recipients whose private keys we don't hold.
      </p>

      <h3>If they steal a user's CLI token</h3>
      <p>
        They can call the API as that user. They can pull ciphertext for any
        workspace the user belongs to — but they still need the user's age
        private key (separately stored on the laptop) to decrypt it. Tokens
        live in the OS Keychain when available; revoke immediately with{' '}
        <code>envstore logout</code> or by removing the session from the
        account page.
      </p>

      <h3>If they steal a user's age private key</h3>
      <p>
        That's the worst case for one workspace. They can decrypt anything
        that was encrypted to that recipient — past versions encrypted to it,
        and future versions until the key is rotated. They still need a valid
        CLI token to fetch ciphertext; without one, all they have is the
        ability to open files an attacker has already exfiltrated.
      </p>
      <p>
        Mitigation: rotate by registering a new identity, then run{' '}
        <code>envstore rekey</code> from a teammate's machine to re-encrypt
        every current version to the new recipient set. Revoke the old key in
        the account settings so it stops being included on future pushes.
      </p>

      <h3>If they steal a workspace service token</h3>
      <p>
        They have both the bearer AND the age private key (these travel
        together in CI secret storage). Same capability as a stolen user
        key + CLI token, scoped to one workspace. They{' '}
        <strong>cannot</strong> escalate: token-authenticated calls are
        rejected by every mutating endpoint that could mint more tokens,
        invite users, change member roles, modify settings, or touch billing.
      </p>
      <p>
        Mitigation: revoke from the dashboard's Tokens page or via{' '}
        <code>envstore token revoke &lt;id&gt;</code>. Default 90-day expiry
        on every token caps the worst case if revocation is missed.
      </p>

      <h3>If they compromise the envstore web app at runtime</h3>
      <p>
        They could serve a tampered dashboard. They still cannot decrypt
        ciphertext because the dashboard has never had decryption code — the
        threat is limited to social-engineering the user (e.g., showing fake
        invite UI). They cannot make CLIs decrypt for them: the CLI verifies
        ciphertext sha256 against the API's response and decrypts locally.
      </p>

      <h2>How we shrink blast radius</h2>
      <ul>
        <li>
          <strong>Soft-delete with retention.</strong> Workspace, project, and
          environment deletions are soft for a configurable window (default 30
          days). A daily cron sweep hard-deletes past the window and nukes the
          matching R2 objects so retention is real, not aspirational.
        </li>
        <li>
          <strong>Token expiry &amp; revocation.</strong> Workspace service
          tokens default to 90-day expiry (max 365). Revocation is immediate;
          the next API call from a revoked token returns 401.
        </li>
        <li>
          <strong>No token escalation.</strong> Service-token-authenticated
          requests cannot create more tokens, change ACLs, or touch billing.
          Enforced at the bearer-auth layer (<code>requireUserAuth</code>),
          not at every endpoint — single chokepoint, easy to audit.
        </li>
        <li>
          <strong>Audit log without PII.</strong> Every workspace action is
          recorded with actor + action + resource. No IPs, no UAs — the audit
          log answers "who, what, when" without becoming a retention liability.
        </li>
        <li>
          <strong>Token hashing.</strong> Bearer tokens are sha256-hashed at
          rest. A DB dump yields no working credentials.
        </li>
        <li>
          <strong>Recipient hash on every version.</strong> Each pushed
          version records the hash of the recipient set it was encrypted to.
          The CLI compares this to the current set on <code>rekey</code> to
          skip no-ops, and we can detect "this version is no longer reachable
          by anyone" if a workspace's recipient set rotates aggressively.
        </li>
        <li>
          <strong>Trust-on-first-use cache for recipient sets.</strong> The
          CLI remembers every recipient set it has encrypted to per project
          (<code>~/.config/envstore/trust.json</code>, mode 0600). First
          contact prints the full set so you can verify out-of-band; later
          additions require explicit confirmation, or{' '}
          <code>--trust-new</code> in CI. This is the guard against an
          active-API-compromise variant where the server injects an
          attacker-controlled recipient into the push response — a class of
          attack open against any end-to-end-encrypted vault that takes the
          server&apos;s recipient list at face value.
        </li>
        <li>
          <strong>Content-Security-Policy with per-request nonce.</strong>{' '}
          Every page response carries a CSP that pins scripts to a
          one-shot nonce + <code>&apos;strict-dynamic&apos;</code>, blocks
          framing (clickjacking), pins form-action and base-uri to
          <code>&apos;self&apos;</code>, and disables plugins/objects
          entirely. A successful XSS still can&apos;t exfiltrate to an
          attacker host because <code>connect-src</code> is locked to
          envstore + Paddle.
        </li>
      </ul>

      <h2>What's deliberately out of scope (for now)</h2>
      <ul>
        <li>
          <strong>Hardware-token (FIDO2 / passkey) auth at the API layer.</strong>{' '}
          We support OAuth + email OTP for the web; CLI tokens are bearer.
          A future "step-up auth" for sensitive actions (delete workspace,
          billing changes) is reasonable but not yet built.
        </li>
        <li>
          <strong>Environment-scoped service tokens.</strong>{' '}
          Workspace tokens can be scoped down to specific projects today
          (a token minted with <code>--projects test,staging</code> can&apos;t
          touch production); per-environment scoping isn&apos;t built yet.
        </li>
        <li>
          <strong>Anomaly detection on token use.</strong> We record last-used
          timestamps but don't currently alert on unusual patterns
          ("token X just pulled from a country it's never pulled from").
        </li>
      </ul>

      <h2>Reporting a vulnerability</h2>
      <p>
        Send security reports to{' '}
        <a href="mailto:security@envstore.xyz">security@envstore.xyz</a>. We
        respond within 72 hours. Please don't open public issues for
        vulnerabilities — give us a chance to fix and roll out before
        disclosure.
      </p>
      <p>
        envstore is open source under AGPL v3:{' '}
        <a
          href="https://github.com/michael-ketzer/envstore.xyz"
          target="_blank"
          rel="noreferrer"
        >
          github.com/michael-ketzer/envstore.xyz
        </a>
        . The crypto code lives in{' '}
        <code>packages/crypto</code>; the auth and audit code in{' '}
        <code>apps/web/src/lib</code>.
      </p>
    </>
  );
}
