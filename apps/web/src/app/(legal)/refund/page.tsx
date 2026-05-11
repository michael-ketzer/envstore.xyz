import type { Metadata } from 'next';

import { PRICING } from '@envstore/shared';

export const metadata: Metadata = {
  title: 'Refund Policy — envstore',
  description:
    '14-day money-back guarantee. Cancellation continues service to the end of the billing period. Paddle handles refunds.',
};

const trialDays = PRICING.trialDays;

export default function RefundPolicyPage() {
  return (
    <>
      <h1>Refund Policy</h1>
      <p className="lede">Last updated: 11 May 2026</p>

      <h2>Payment processor</h2>
      <p>
        All payments are processed by our payment provider{' '}
        <a href="https://www.paddle.com" target="_blank" rel="noreferrer">
          Paddle
        </a>
        , which acts as our merchant of record. Refunds are issued by Paddle on
        our behalf under Paddle's{' '}
        <a
          href="https://www.paddle.com/legal/buyer-terms"
          target="_blank"
          rel="noreferrer"
        >
          Buyer Terms
        </a>
        . Where this policy and Paddle's terms overlap, Paddle's terms govern
        the actual payment transaction.
      </p>

      <h2>{trialDays}-day money-back guarantee</h2>
      <p>
        If envstore isn't a fit, we'll refund your first payment in full
        within <strong>{trialDays} days</strong> of purchase — no questions,
        no friction. This applies to your initial subscription charge for each
        workspace, not to subsequent renewals.
      </p>

      <h2>How to request a refund</h2>
      <ol style={{ paddingLeft: '1.25rem', listStyle: 'decimal', marginBottom: '1rem' }}>
        <li style={{ fontSize: '0.9375rem', lineHeight: 1.65, marginBottom: '0.375rem' }}>
          Email{' '}
          <a href="mailto:billing@envstore.xyz">billing@envstore.xyz</a> from
          the email address on your account, OR
        </li>
        <li style={{ fontSize: '0.9375rem', lineHeight: 1.65, marginBottom: '0.375rem' }}>
          Submit a request through Paddle's{' '}
          <a
            href="https://www.paddle.com/contact"
            target="_blank"
            rel="noreferrer"
          >
            buyer help center
          </a>{' '}
          using the order ID from your purchase email.
        </li>
      </ol>
      <p>
        Either route works. Include the order ID or the email on your account
        so we can find your subscription quickly.
      </p>

      <h2>Processing</h2>
      <p>
        Approved refunds are returned to the original payment method within{' '}
        <strong>14 days</strong> of approval. The bank or card issuer's
        clearing time then applies on top — typically another 3–10 business
        days. Paddle emails you a confirmation when the refund is issued.
      </p>

      <h2>Cancellation</h2>
      <p>
        Cancelling a workspace's subscription stops future charges. Your
        access continues until the end of the current paid period — you don't
        lose access mid-month. After cancellation we keep your data
        <strong> readable for {PRICING.postCancelReadGraceDays} days</strong> so
        you can <code>envstore pull</code> everything you need before
        permanent deletion.
      </p>
      <p>
        Cancellation is one click from{' '}
        <code>Dashboard → workspace → Settings</code>. You don't need to email
        us.
      </p>

      <h2>Out of scope</h2>
      <p>This policy does not cover:</p>
      <ul>
        <li>
          Workspaces where the subscription was already cancelled and the
          billing period elapsed
        </li>
        <li>
          Renewal charges — please cancel before the renewal date if you don't
          intend to continue. Free trial reminders are sent ahead of time so
          you can decide.
        </li>
        <li>
          Refund requests submitted more than {trialDays} days after purchase,
          unless required by applicable consumer protection law
        </li>
        <li>
          Suspensions or terminations due to violation of our{' '}
          <a href="/terms">Terms of Service</a>
        </li>
        <li>
          Issues outside our control — e.g. your bank reversing a payment via
          chargeback, in which case Paddle handles the chargeback under its
          own dispute process
        </li>
      </ul>

      <h2>Statutory rights</h2>
      <p>
        Nothing in this policy limits any rights you have as a consumer under
        applicable law. EU customers have a 14-day right of withdrawal for
        digital services. By starting to use envstore before the 14-day period
        ends, you may waive that right — Paddle will surface this at
        checkout. Even when waived, our {trialDays}-day money-back guarantee
        above still applies as a goodwill offer.
      </p>

      <h2>Questions?</h2>
      <p>
        Email <a href="mailto:billing@envstore.xyz">billing@envstore.xyz</a>.
        We aim to reply within 2 business days.
      </p>
    </>
  );
}
