import Link from 'next/link';

import { PRICING } from '@envstore/shared';

const productLinks = [
  { href: '/', label: 'Home' },
  { href: '/#pricing', label: 'Pricing' },
  { href: '/#faq', label: 'FAQ' },
  { href: 'https://github.com/michael-ketzer/envstore.xyz', label: 'GitHub', external: true },
];

const legalLinks = [
  { href: '/terms', label: 'Terms' },
  { href: '/privacy', label: 'Privacy' },
  { href: '/refund', label: 'Refund policy' },
  { href: '/imprint', label: 'Imprint' },
];

const resourceLinks = [
  { href: '/install', label: 'CLI installer' },
  { href: '/schema/envstore.json', label: 'envstore.json schema' },
  { href: 'https://github.com/FiloSottile/age', label: 'age (encryption)', external: true },
  { href: 'mailto:security@envstore.xyz', label: 'Report a vulnerability', external: true },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Link href="/" className="font-mono text-sm font-semibold">
              envstore
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">
              Zero-knowledge encrypted .env file storage. ${(PRICING.monthlyCents / 100).toFixed(2)}{' '}
              per workspace per month.
            </p>
            <p className="mt-3 text-xs text-muted-foreground">
              AGPL v3 ·{' '}
              <a
                href="https://github.com/michael-ketzer/envstore.xyz"
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                Source on GitHub
              </a>
            </p>
          </div>
          <FooterColumn title="Product" links={productLinks} />
          <FooterColumn title="Legal" links={legalLinks} />
          <FooterColumn title="Resources" links={resourceLinks} />
        </div>

      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: ReadonlyArray<{ href: string; label: string; external?: boolean }>;
}) {
  return (
    <div>
      <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        {title}
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.href}>
            {link.external ? (
              <a
                href={link.href}
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </a>
            ) : (
              <Link
                href={link.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
