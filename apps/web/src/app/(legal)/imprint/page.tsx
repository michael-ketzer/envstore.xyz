import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Imprint — envstore',
  description: 'Legal operator information for envstore (§ 5 DDG).',
};

// Operator details below are real. VAT ID still needs to be decided (kept or
// removed) before broad launch.
export default function ImprintPage() {
  return (
    <>
      <h1>Imprint</h1>
      <p className="lede">
        Information according to § 5 DDG (Digitale-Dienste-Gesetz), the German
        statute that replaced § 5 TMG on 14 May 2024.
      </p>

      <h2>Operator</h2>
      <p>
        <strong>Michael Ketzer</strong>
        <br />
        Rotkehlchenweg 51
        <br />
        40789 Monheim am Rhein
        <br />
        Germany
      </p>

      <h2>Contact</h2>
      <p>
        Email: <a href="mailto:legal@envstore.xyz">legal@envstore.xyz</a>
        <br />
        Phone: <a href="tel:+4915115677093">+49 151 15677093</a>
      </p>

      <h2>Responsible for content according to § 18 Abs. 2 MStV</h2>
      <p>
        Michael Ketzer
        <br />
        Rotkehlchenweg 51
        <br />
        40789 Monheim am Rhein
      </p>

      <h2>EU dispute resolution</h2>
      <p>
        The European Commission provides a platform for online dispute
        resolution (OS):{' '}
        <a href="https://ec.europa.eu/consumers/odr/" target="_blank" rel="noreferrer">
          https://ec.europa.eu/consumers/odr/
        </a>
        . Our email address is listed above.
      </p>
      <p>
        We are not obliged and not willing to participate in dispute
        resolution proceedings before a consumer arbitration board.
      </p>

      <h2>Payment processor</h2>
      <p>
        Payments are processed by Paddle as the merchant of record. See our{' '}
        <a href="/terms">Terms</a> and{' '}
        <a href="/refund">Refund Policy</a> for details.
      </p>
    </>
  );
}
