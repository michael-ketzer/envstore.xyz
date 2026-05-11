import Link from 'next/link';

import { buttonVariants, Logo } from '@envstore/ui';
import { PRICING, DEFAULTS } from '@envstore/shared';

const features = [
  {
    title: 'Zero-knowledge',
    body: `Files are encrypted on your machine with age. The server stores ciphertext it has no way to decrypt. Lose your key — even we can't help you recover.`,
  },
  {
    title: 'Open source',
    body: `AGPL v3 on GitHub. Audit every line. Run your own instance if you want. Don't trust — verify.`,
  },
  {
    title: 'Comically cheap',
    body: `$${(PRICING.monthlyCents / 100).toFixed(2)} per workspace, per month. Not per user. Invite your whole team — unlimited members. ${PRICING.trialDays}-day trial.`,
  },
];

const comparison: Array<{ row: string; envstore: string; others: string }> = [
  { row: 'Pricing', envstore: '$1.99 / workspace', others: '$5–8 / user' },
  { row: 'Team members', envstore: 'Unlimited', others: 'Per-seat' },
  { row: 'Server decrypts your files?', envstore: 'Never. Cannot.', others: '"Encrypted at rest"' },
  { row: 'Open source', envstore: 'AGPL v3', others: 'Closed source' },
  { row: 'Key management', envstore: 'You own it', others: 'Vendor manages' },
  { row: 'CLI as a first-class citizen', envstore: 'Required for writes', others: 'Optional' },
];

export default function LandingPage() {
  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="envstore home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-4 text-sm">
            <a
              href="https://github.com/mketzer/envstore.xyz"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground"
            >
              GitHub
            </a>
            <Link href="/login" className="text-muted-foreground hover:text-foreground">
              Sign in
            </Link>
            <Link href="/login" className={buttonVariants({ size: 'sm' })}>
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            Zero-knowledge env file storage
          </p>
          <h1 className="mt-4 max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
            Stop trusting vendors with your secrets.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg text-muted-foreground">
            Push your <code className="font-mono text-foreground">.env</code> files to envstore.
            They're encrypted on <em>your</em> machine with <em>your</em> key before they leave.
            Even we can't read them. $1.99 per workspace. Unlimited members.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-4">
            <Link href="/login" className={buttonVariants({ size: 'lg' })}>
              Start {PRICING.trialDays}-day free trial
            </Link>
            <a
              href="https://github.com/mketzer/envstore.xyz"
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Read the source →
            </a>
          </div>

          <pre className="mt-12 inline-block rounded-md border border-border bg-muted/50 px-5 py-4 font-mono text-sm text-foreground/90">
{`$ curl -fsSL https://envstore.xyz/install | sh
$ envstore login
$ envstore push .env`}
          </pre>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto grid max-w-6xl gap-8 px-6 py-20 sm:grid-cols-3">
          {features.map((f) => (
            <div key={f.title}>
              <h2 className="text-lg font-semibold">{f.title}</h2>
              <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="border-b border-border bg-muted/30">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">How it works</h2>
          <p className="mt-4 max-w-2xl text-muted-foreground">
            Encryption happens locally. The web dashboard shows metadata only — names, sizes,
            timestamps, members. There is no decrypt button to even try.
          </p>
          <ol className="mt-12 grid gap-8 sm:grid-cols-3">
            <Step
              n={1}
              title="Install & sign in"
              body="OAuth (GitHub, Google) or a 6-digit email code. Then install the CLI."
            />
            <Step
              n={2}
              title="Push"
              body={
                <>
                  Run <code className="font-mono text-foreground">envstore push .env</code>. The CLI encrypts
                  to every workspace member's public key with age, uploads the ciphertext to R2.
                </>
              }
            />
            <Step
              n={3}
              title="Pull"
              body={
                <>
                  On any machine, <code className="font-mono text-foreground">envstore pull</code>. Only your
                  private key decrypts. Server never sees plaintext.
                </>
              }
            />
          </ol>
          <div className="mt-12 rounded-md border border-border bg-background p-6">
            <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              The hard rule
            </p>
            <p className="mt-2 text-pretty text-base text-foreground">
              Your private key never enters the browser. The server never receives it. If you lose
              every copy of your key, your data is gone. We say this loud and we mean it.
            </p>
          </div>
        </div>
      </section>

      <section className="border-b border-border">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <h2 className="text-3xl font-semibold tracking-tight">vs. the other vaults</h2>
          <div className="mt-10 overflow-hidden rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="px-6 py-3 text-left font-medium text-muted-foreground"></th>
                  <th className="px-6 py-3 text-left font-medium">envstore</th>
                  <th className="px-6 py-3 text-left font-medium text-muted-foreground">
                    Other vaults
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {comparison.map((c) => (
                  <tr key={c.row}>
                    <td className="px-6 py-4 text-muted-foreground">{c.row}</td>
                    <td className="px-6 py-4 font-medium">{c.envstore}</td>
                    <td className="px-6 py-4 text-muted-foreground">{c.others}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section>
        <div className="mx-auto max-w-6xl px-6 py-24 text-center">
          <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
            ${(PRICING.monthlyCents / 100).toFixed(2)} a month. Your keys.
          </h2>
          <p className="mt-4 text-muted-foreground">
            Try it free for {PRICING.trialDays} days. No card on the trial. Cancel and we keep
            your data readable for {DEFAULTS.softDeleteRetentionDays} days so you can pull it
            out.
          </p>
          <div className="mt-8">
            <Link href="/login" className={buttonVariants({ size: 'lg' })}>
              Get started
            </Link>
          </div>
        </div>
      </section>

      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-4 px-6 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <div>© {new Date().getFullYear()} envstore — AGPL v3.</div>
          <div className="flex gap-4">
            <a href="https://github.com/mketzer/envstore.xyz" target="_blank" rel="noreferrer">
              GitHub
            </a>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
          </div>
        </div>
      </footer>
    </main>
  );
}

function Step({ n, title, body }: { n: number; title: string; body: React.ReactNode }) {
  return (
    <li>
      <div className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
        Step {n}
      </div>
      <h3 className="mt-2 text-lg font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</p>
    </li>
  );
}
