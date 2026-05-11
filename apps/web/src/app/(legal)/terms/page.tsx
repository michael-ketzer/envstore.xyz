import type { Metadata } from 'next';

import { PRICING } from '@envstore/shared';

export const metadata: Metadata = {
  title: 'Terms of Service — envstore',
  description: 'The rules of using envstore. Short, plain English.',
};

const price = (PRICING.monthlyCents / 100).toFixed(2);

export default function TermsOfServicePage() {
  return (
    <>
      <h1>Terms of Service</h1>
      <p className="lede">Last updated: 11 May 2026</p>

      <h2>What this is</h2>
      <p>
        envstore is a service that stores end-to-end encrypted <code>.env</code>{' '}
        files on your behalf. You upload ciphertext that only you (and people
        you explicitly add) can decrypt. We can't read your secrets, even if we
        wanted to.
      </p>
      <p>
        These Terms are an agreement between you and the operator listed in our{' '}
        <a href="/imprint">Imprint</a> ("we", "us"). By creating an account, you
        agree to them. If you don't, please don't sign up.
      </p>

      <h2>Eligibility</h2>
      <ul>
        <li>You must be at least 16 years old (18 in jurisdictions that require it).</li>
        <li>You must provide accurate account information.</li>
        <li>One person per account. Workspaces can be shared with teammates.</li>
      </ul>

      <h2>The service</h2>
      <p>
        envstore consists of:
      </p>
      <ul>
        <li>The web dashboard at envstore.xyz</li>
        <li>The <code>envstore</code> command-line tool</li>
        <li>The API endpoints under <code>/api/v1/*</code></li>
        <li>The encrypted storage backing the above</li>
      </ul>
      <p>
        We do our best to keep the service running but don't guarantee any
        specific uptime. We may run maintenance windows and announce them in
        advance when we can.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>
          You're responsible for keeping your sign-in credentials and your
          local age private key safe.
        </li>
        <li>
          envstore is for storing text-based environment variables. Binary
          files, images, and anything that isn't a real env file are blocked
          at the CLI and refused at the server (1 MB ciphertext cap).
        </li>
        <li>
          <strong>If you lose every copy of your age private key, your data is
            permanently unrecoverable.</strong>{' '}
          There is no server-side recovery flow — that's the entire point of
          zero-knowledge.
        </li>
      </ul>

      <h2>Your content</h2>
      <p>
        You keep ownership of everything you upload. We need only the limited
        rights necessary to store and transmit your encrypted ciphertext on
        your behalf — nothing more. We do not analyse it, sell it, or share it
        with anyone outside the subprocessors named in our{' '}
        <a href="/privacy">Privacy Policy</a>.
      </p>
      <p>By uploading content to envstore, you represent and warrant that:</p>
      <ul>
        <li>You have all rights necessary to store and transmit it.</li>
        <li>
          It does not violate any law that applies to you, or to the operator
          in Germany (see <a href="/imprint">Imprint</a>).
        </li>
        <li>
          It does not infringe any third party's rights — including copyright,
          trade secrets, or other people's personal data without a lawful
          basis.
        </li>
      </ul>
      <p>
        <strong>You are solely responsible for the content you upload, share,
          and pull through envstore.</strong>{' '}
        envstore is end-to-end encrypted: the server stores ciphertext that we
        cannot decrypt and cannot inspect. We have no technical way to
        pre-screen, moderate, or even know what is inside a given file. That
        responsibility — what gets stored, who gets invited to a workspace,
        what they then do with the data — rests with you.
      </p>
      <p>
        If any third-party claim is made against us because of content you
        uploaded, shared, or distributed via envstore (for example: copyright,
        data-protection, or unlawful-content complaints), you agree to{' '}
        <strong>indemnify and hold us harmless</strong>, including reasonable
        legal costs — except where the claim is caused by our own breach of
        these Terms or applicable law. Nothing in this section limits any
        rights you have under mandatory consumer-protection law.
      </p>

      <h2>Our role as a hosting service</h2>
      <p>
        envstore is a hosting service in the sense of Article 3(g)(iii) of{' '}
        <a
          href="https://eur-lex.europa.eu/eli/reg/2022/2065"
          target="_blank"
          rel="noreferrer"
        >
          Regulation (EU) 2022/2065 (the Digital Services Act, "DSA")
        </a>
        , implemented in Germany via the Digitale-Dienste-Gesetz (DDG, which
        replaced the relevant parts of the TMG on 14 May 2024). We store
        information provided by — and at the request of — our users.
      </p>
      <p>
        Under Article 6 DSA and § 7 ff. DDG we are not liable for the content
        a user stores on the service as long as we do not have actual
        knowledge that it is illegal and, once we obtain such knowledge, act
        expeditiously to remove or disable access to it. Because envstore is
        end-to-end encrypted, we cannot in practice gain knowledge of the
        plaintext of any user file. We undertake no general monitoring
        obligation (Article 8 DSA).
      </p>
      <p>
        <strong>Notice of illegal content.</strong> If you believe content
        stored on envstore is illegal, send a notice to{' '}
        <a href="mailto:legal@envstore.xyz">legal@envstore.xyz</a> including:
        identification of the content (workspace / project / version where
        possible), the law you believe is violated, your contact details, and
        — if you are a rights holder — proof of your standing. We will assess
        the notice and take appropriate action, which may include suspending
        the affected workspace or disabling access pending investigation.
        Knowingly false notices may give rise to liability under Article 23(2)
        DSA.
      </p>

      <h2>Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use envstore as generic encrypted file hosting (it's not for that)</li>
        <li>Reverse-engineer or attempt to bypass our rate limiting or auth gates beyond what's allowed by AGPL</li>
        <li>Probe the service for vulnerabilities outside our coordinated disclosure scope (see <a href="https://github.com/michael-ketzer/envstore.xyz/blob/main/SECURITY.md" target="_blank" rel="noreferrer">SECURITY.md</a>)</li>
        <li>Send unsolicited invitations or otherwise abuse the invite flow</li>
        <li>Interfere with other customers' service or data</li>
        <li>Use the service for anything illegal under your or our jurisdiction</li>
      </ul>
      <p>
        We may suspend accounts that violate these rules. For serious violations
        we may terminate without refund.
      </p>

      <h2>Pricing and billing</h2>
      <ul>
        <li>
          ${price} per workspace per month. Each workspace you create gets
          its own billing line. Unlimited members per workspace.
        </li>
        <li>
          Every new workspace starts with a {PRICING.trialDays}-day free trial.
          No card required for the trial.
        </li>
        <li>
          Subscriptions renew automatically until you cancel them.
        </li>
        <li>
          Billing is processed by{' '}
          <a href="https://www.paddle.com" target="_blank" rel="noreferrer">
            Paddle
          </a>
          , our merchant of record. Paddle handles invoicing, taxes (including
          VAT), and chargebacks. Their{' '}
          <a
            href="https://www.paddle.com/legal/terms"
            target="_blank"
            rel="noreferrer"
          >
            buyer terms
          </a>{' '}
          apply to the payment transaction.
        </li>
      </ul>

      <h2>Cancellation and refunds</h2>
      <p>
        You can cancel any workspace's subscription at any time from the
        dashboard. After cancellation, the workspace stays readable for{' '}
        {PRICING.postCancelReadGraceDays} days so you can pull your data out;
        no further charges accrue.
      </p>
      <p>
        Refund details — including our {PRICING.trialDays}-day money-back
        guarantee — are documented separately in our{' '}
        <a href="/refund">Refund Policy</a>.
      </p>

      <h2>Open source</h2>
      <p>
        envstore is licensed under{' '}
        <a
          href="https://www.gnu.org/licenses/agpl-3.0.html"
          target="_blank"
          rel="noreferrer"
        >
          AGPL v3
        </a>
        . You can run your own instance. If you do, the AGPL requires that
        modifications you make available as a hosted service must also be open
        sourced.
      </p>

      <h2>Termination</h2>
      <ul>
        <li>
          You can delete your account at any time. Doing so soft-deletes your
          data; permanent deletion follows after the workspace's configured
          retention window.
        </li>
        <li>
          We may terminate accounts that violate these Terms or that go unused
          for an extended period (no fewer than 12 months without a sign-in).
          We'll email you before doing so.
        </li>
        <li>
          On termination, your subscription is cancelled and the cancellation
          policy above applies.
        </li>
      </ul>

      <h2>Liability</h2>
      <p>
        We provide envstore "as is" without warranties. To the maximum extent
        permitted by law, our liability for any claim related to your use of
        the service is capped at the amount you paid us in the 12 months
        preceding the claim. We aren't liable for indirect, consequential, or
        punitive damages.
      </p>
      <p>
        We are not liable for losses caused by you losing your local age
        private key. We literally cannot recover it.
      </p>
      <p>
        Nothing in these Terms limits our liability for fraud, willful
        misconduct, or for anything that can't be limited under applicable law
        (in the EU, that includes death, personal injury, and intent or gross
        negligence).
      </p>

      <h2>Changes</h2>
      <p>
        We may update these Terms. If a change is material — for example,
        affecting pricing or significant rights — we'll email you at least 14
        days before it takes effect. Continued use after the effective date
        means you accept the change. If you don't, you can cancel.
      </p>

      <h2>Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of the operator's country of
        registration (see <a href="/imprint">Imprint</a>). Disputes will be
        handled by the competent courts there, unless mandatory consumer
        protection laws in your country of residence give you a stronger venue.
      </p>
      <p>
        If you're a consumer in the EU, you have the right to use the European
        Commission's{' '}
        <a
          href="https://ec.europa.eu/consumers/odr"
          target="_blank"
          rel="noreferrer"
        >
          ODR platform
        </a>
        . We don't currently participate in any alternative dispute resolution
        scheme.
      </p>

      <h2>Contact</h2>
      <p>
        Questions about these Terms:{' '}
        <a href="mailto:legal@envstore.xyz">legal@envstore.xyz</a>
        <br />
        Operator details: <a href="/imprint">Imprint</a>
      </p>
    </>
  );
}
