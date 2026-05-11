import Link from 'next/link';

import { Footer } from '@/components/footer';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" className="font-mono text-sm font-semibold">
            envstore
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <div className="mx-auto max-w-3xl px-6 py-16">
          {/* Custom prose-ish styling tuned for our typography. Long-form legal
              text reads better with tight headings and generous body spacing. */}
          <article className="legal-prose">{children}</article>
        </div>
      </main>

      <Footer />

      <style>{`
        .legal-prose h1 {
          font-size: 2.25rem;
          font-weight: 600;
          line-height: 1.1;
          letter-spacing: -0.02em;
          margin-bottom: 0.5rem;
        }
        .legal-prose .lede {
          color: hsl(var(--muted-foreground));
          font-size: 0.875rem;
          margin-bottom: 2.5rem;
        }
        .legal-prose h2 {
          font-size: 1.25rem;
          font-weight: 600;
          margin-top: 2.5rem;
          margin-bottom: 0.75rem;
        }
        .legal-prose h3 {
          font-size: 1rem;
          font-weight: 600;
          margin-top: 1.5rem;
          margin-bottom: 0.5rem;
        }
        .legal-prose p {
          font-size: 0.9375rem;
          line-height: 1.65;
          margin-bottom: 1rem;
          color: hsl(var(--foreground));
        }
        .legal-prose ul {
          list-style: disc;
          padding-left: 1.25rem;
          margin-bottom: 1rem;
        }
        .legal-prose ul li {
          font-size: 0.9375rem;
          line-height: 1.65;
          margin-bottom: 0.375rem;
        }
        .legal-prose a {
          color: hsl(var(--foreground));
          text-decoration: underline;
          text-underline-offset: 2px;
        }
        .legal-prose code {
          font-family: var(--font-mono, ui-monospace, monospace);
          font-size: 0.85em;
          background: hsl(var(--muted));
          padding: 0.1em 0.3em;
          border-radius: 4px;
        }
        .legal-prose strong {
          font-weight: 600;
        }
      `}</style>
    </div>
  );
}
