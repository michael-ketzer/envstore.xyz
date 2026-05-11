import Link from 'next/link';

import { DEFAULTS, PRICING } from '@envstore/shared';
import { buttonVariants, Logo } from '@envstore/ui';

import { CodeBlock } from '@/components/code-block';
import { Footer } from '@/components/footer';

const priceDollars = (PRICING.monthlyCents / 100).toFixed(2);

const features = [
  {
    title: 'Zero-knowledge by design',
    body: `Your .env files are encrypted on your laptop with age before they leave. The server stores ciphertext it physically can't open. We never see your secrets — neither does an intruder, a subpoena, or a future us.`,
  },
  {
    title: 'Priced like a SaaS should be',
    body: `$${priceDollars} per workspace, per month. Flat. Invite everyone on your team — there is no per-seat charge. The pricing page will not change every time you hire someone.`,
  },
  {
    title: 'Open source, AGPL v3',
    body: `Read every line of the encryption, the CLI, the API. Run your own if you want — the code is the product. We don't get to claim "secure" without showing our work.`,
  },
];

const steps = [
  {
    n: 1,
    title: 'Install the CLI',
    body: (
      <>
        One command — see the hero above. The CLI is a single static binary you can audit, vendor,
        or check into CI. No Node, no Python, no surprises.
      </>
    ),
  },
  {
    n: 2,
    title: 'Push your .env',
    body: (
      <>
        Run{' '}
        <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.85em]">
          envstore push .env
        </code>{' '}
        and the CLI encrypts your file to every workspace member's public key, then uploads the
        ciphertext. Your secrets never hit a server that can read them.
      </>
    ),
  },
  {
    n: 3,
    title: 'Pull on any machine',
    body: (
      <>
        On a teammate's laptop, a fresh CI runner, your new MacBook — run{' '}
        <code className="bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.85em]">
          envstore pull
        </code>
        . Their private key decrypts. Lose every copy of every member's key and the data is gone. We
        mean it.
      </>
    ),
  },
];

const comparison: Array<{ row: string; envstore: string; others: string }> = [
  { row: 'Pricing', envstore: `$${priceDollars} / workspace`, others: '$5–8 / user / month' },
  { row: 'Team members', envstore: 'Unlimited', others: 'Per-seat' },
  {
    row: 'Server can decrypt your files',
    envstore: 'No. By construction.',
    others: 'Yes — "encrypted at rest"',
  },
  { row: 'License', envstore: 'AGPL v3 — fully readable', others: 'Closed source' },
  { row: 'Key custody', envstore: 'You hold the key', others: 'Vendor holds the key' },
  {
    row: 'Web dashboard can leak secrets',
    envstore: 'No — no decrypt path exists',
    others: 'XSS / session theft',
  },
  {
    row: 'CLI as primary interface',
    envstore: 'Yes, required for writes',
    others: 'Often an afterthought',
  },
];

const faq: Array<{ q: string; a: React.ReactNode }> = [
  {
    q: `Wait — really, you can't read my secrets?`,
    a: (
      <>
        Correct. The CLI encrypts your file with age (X25519 + ChaCha20-Poly1305) on your machine to
        every workspace member's public key. We store the resulting ciphertext on Cloudflare R2. We
        do not hold any private key. There is no decrypt endpoint, no admin override, no support
        backdoor. If we wanted to read your file we would need to compromise your laptop, not our
        server.
      </>
    ),
  },
  {
    q: `What happens if I lose my key?`,
    a: (
      <>
        Your data is gone. We tell you that loud and often. This is the tradeoff for a vendor that
        cannot read your secrets. We help you avoid it: the CLI prompts you to back up your identity
        on first run, supports multiple recipients per workspace, and re-encrypts on every push. A
        teammate or a second key on a yubikey gets you out of single-point-of-failure territory.
      </>
    ),
  },
  {
    q: `How is this different from Doppler, Infisical, Vault, 1Password Secrets?`,
    a: (
      <>
        Those products are good, but they all hold your keys. Their server has, at some layer, the
        capability to return plaintext — which means an internal compromise or a credential theft is
        a leak. envstore deliberately gives up that capability. The flip side: we cannot offer
        "click to reveal in the web UI" because there is nothing on the server to reveal. If you
        want a vault that can show you the value in a browser, those vendors are the right fit. If
        you want a vendor that cannot leak your secrets even when breached, you are in the right
        place.
      </>
    ),
  },
  {
    q: `My team needs to share .env files for staging and production. Does this work?`,
    a: (
      <>
        Yes — that is exactly the use case. Each workspace member registers their public key. Every
        push encrypts to all of them. Add a new member: the next push picks them up automatically.
        Remove a member: rotate by re-pushing. The CLI handles the bookkeeping; you handle the
        humans.
      </>
    ),
  },
  {
    q: `What does the web dashboard do, then?`,
    a: (
      <>
        Metadata only — projects, environments, member list, file names, sizes, timestamps, key
        fingerprints, audit log. You can manage your workspace and billing from the browser. You
        cannot decrypt anything from the browser. There is no "view file" button. We did not build
        one, and we are not going to.
      </>
    ),
  },
  {
    q: `Why AGPL v3 and not MIT?`,
    a: (
      <>
        Two reasons. First, AGPL lets us be open without giving away the ability to run the business
        — if a competitor hosts envstore as a service they have to share their changes back. Second,
        you can self-host today, with the same code we run. There is no proprietary "enterprise
        edition." If we ever get acquired and the new owner gets cute, you fork.
      </>
    ),
  },
  {
    q: `Is this production-ready?`,
    a: (
      <>
        envstore is early. The crypto primitives are not — they are age, an off-the-shelf,
        peer-reviewed format. The web app, billing, and CLI are new, and you should treat the
        service like any other early-stage product: keep a backup of your secrets in your password
        manager, watch the changelog, and tell us when something is wrong. We will earn the word
        "stable" by behaving like it.
      </>
    ),
  },
];

export default function LandingPage() {
  return (
    <div className="bg-background text-foreground flex min-h-screen flex-col">
      <header className="border-border bg-background/80 sticky top-0 z-10 border-b backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <Link href="/" aria-label="envstore home">
            <Logo />
          </Link>
          <nav className="flex items-center gap-2 text-sm sm:gap-5">
            <a
              href="#features"
              className="text-muted-foreground hover:text-foreground hidden transition-colors sm:inline"
            >
              Features
            </a>
            <a
              href="#pricing"
              className="text-muted-foreground hover:text-foreground hidden transition-colors sm:inline"
            >
              Pricing
            </a>
            <a
              href="#faq"
              className="text-muted-foreground hover:text-foreground hidden transition-colors sm:inline"
            >
              FAQ
            </a>
            <a
              href="https://github.com/michael-ketzer/envstore.xyz"
              target="_blank"
              rel="noreferrer"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              GitHub
            </a>
            <Link
              href="/login"
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              Sign in
            </Link>
            <Link href="/login" className={buttonVariants({ size: 'sm' })}>
              Get started
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="border-border border-b">
          <div className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              Zero-knowledge .env storage · ${priceDollars}/mo per workspace
            </p>
            <h1 className="mt-4 max-w-3xl text-balance text-5xl font-semibold leading-[1.05] tracking-tight sm:text-6xl">
              Stop handing your secrets to vendors who can read them.
            </h1>
            <p className="text-muted-foreground mt-6 max-w-2xl text-pretty text-lg">
              envstore is encrypted <em>.env</em> storage for teams that take "least privilege"
              literally. Your secrets get encrypted on your laptop with your key — and arrive on our
              servers as ciphertext we cannot open. End-to-end encryption with X25519 +
              ChaCha20-Poly1305. Open source. Comically cheap.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-4">
              <Link href="/login" className={buttonVariants({ size: 'lg' })}>
                Start {PRICING.trialDays}-day free trial
              </Link>
              <a
                href="https://github.com/michael-ketzer/envstore.xyz"
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
              >
                Read the source on GitHub →
              </a>
            </div>

            <CodeBlock
              className="mt-12 max-w-xl"
              code={`curl -fsSL https://envstore.xyz/install | sh`}
              label="Copy install command"
            />
          </div>
        </section>

        <section id="features" className="border-border border-b">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              What you get
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Boring crypto. Sharp pricing. Honest scope.
            </h2>
            <div className="mt-12 grid gap-8 sm:grid-cols-3">
              {features.map((f) => (
                <div key={f.title} className="border-border bg-background rounded-md border p-6">
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="border-border bg-muted/20 border-b">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              How it works
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Three commands. Real encryption.
            </h2>
            <p className="text-muted-foreground mt-6 max-w-2xl">
              All cryptography happens on your machine via the CLI. The web dashboard shows metadata
              — projects, environments, member lists, timestamps. There is no decrypt button to
              click, because there is nothing on the server to decrypt.
            </p>
            <ol className="mt-12 grid gap-8 lg:grid-cols-3">
              {steps.map((s) => (
                <li key={s.n} className="border-border bg-background rounded-md border p-6">
                  <div className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                    Step {s.n}
                  </div>
                  <h3 className="mt-2 text-lg font-semibold">{s.title}</h3>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{s.body}</p>
                </li>
              ))}
            </ol>
            <div className="border-border bg-background mt-12 rounded-md border p-6">
              <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                The hard rule
              </p>
              <p className="mt-3 text-pretty">
                Your private key never enters the browser. The server never receives it. If you lose
                every copy of your key, your data is gone — we don't have a backdoor for you,
                because we don't have a backdoor for anyone.
              </p>
            </div>
          </div>
        </section>

        <section className="border-border border-b">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              Comparison
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              envstore vs. the other vaults
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl">
              We are not the right tool for every job. We are the right tool when "the vendor can't
              see it" is a non-negotiable.
            </p>
            <div className="border-border mt-10 overflow-hidden rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40">
                  <tr>
                    <th className="text-muted-foreground px-6 py-3 text-left font-medium"></th>
                    <th className="px-6 py-3 text-left font-medium">envstore</th>
                    <th className="text-muted-foreground px-6 py-3 text-left font-medium">
                      Typical secrets SaaS
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-border divide-y">
                  {comparison.map((c) => (
                    <tr key={c.row}>
                      <td className="text-muted-foreground px-6 py-4">{c.row}</td>
                      <td className="px-6 py-4 font-medium">{c.envstore}</td>
                      <td className="text-muted-foreground px-6 py-4">{c.others}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section id="pricing" className="border-border bg-muted/20 border-b">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              Pricing
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              One price. No per-seat fee. No "contact sales".
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl">
              You pay per workspace, not per person. Bring your whole team. Bring your CI runners.
              Bring the intern.
            </p>
            <div className="mt-12 grid gap-6 lg:grid-cols-2">
              <PricingCard
                badge="Personal"
                title="Personal workspace"
                price="Free"
                subtitle="For your own machines"
                features={[
                  'A personal workspace at /me',
                  'Unlimited projects & environments',
                  'Full CLI — push, pull, history',
                  'Single user (you)',
                  'Same zero-knowledge encryption',
                ]}
                cta="Create a free account"
                ctaHref="/login"
              />
              <PricingCard
                badge="Team"
                highlight
                title="Team workspace"
                price={`$${priceDollars}`}
                priceSuffix="/ month"
                subtitle={`Flat fee — unlimited members. ${PRICING.trialDays}-day free trial.`}
                features={[
                  'Everything in Personal',
                  'Unlimited team members (no per-seat charge)',
                  'Multi-recipient encryption (every member can decrypt)',
                  'Audit log of every push & pull',
                  `${DEFAULTS.softDeleteRetentionDays}-day soft-delete window`,
                  'Cancel anytime — see refund policy',
                ]}
                cta={`Start ${PRICING.trialDays}-day free trial`}
                ctaHref="/login"
              />
            </div>
            <p className="text-muted-foreground mt-8 text-xs">
              Billed in USD via{' '}
              <a
                href="https://www.paddle.com"
                target="_blank"
                rel="noreferrer"
                className="hover:text-foreground underline"
              >
                Paddle
              </a>{' '}
              (merchant of record — applicable VAT/sales tax handled automatically). See our{' '}
              <Link href="/terms" className="hover:text-foreground underline">
                Terms
              </Link>{' '}
              and{' '}
              <Link href="/refund" className="hover:text-foreground underline">
                Refund Policy
              </Link>
              .
            </p>
          </div>
        </section>

        <section id="faq" className="border-border border-b">
          <div className="mx-auto max-w-3xl px-6 py-20">
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">FAQ</p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              The honest answers
            </h2>
            <dl className="mt-12 space-y-10">
              {faq.map((item) => (
                <div key={item.q}>
                  <dt className="text-lg font-semibold">{item.q}</dt>
                  <dd className="text-muted-foreground mt-3 text-pretty">{item.a}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section>
          <div className="mx-auto max-w-3xl px-6 py-24 text-center">
            <h2 className="text-balance text-3xl font-semibold tracking-tight sm:text-4xl">
              Take back the keys.
            </h2>
            <p className="text-muted-foreground mt-4 text-pretty">
              ${priceDollars} a month. {PRICING.trialDays}-day free trial, no card required. Cancel
              and we keep your data readable for {PRICING.postCancelReadGraceDays} days so you can
              pull it out.
            </p>
            <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
              <Link href="/login" className={buttonVariants({ size: 'lg' })}>
                Get started free
              </Link>
              <a
                href="https://github.com/michael-ketzer/envstore.xyz"
                target="_blank"
                rel="noreferrer"
                className="text-muted-foreground hover:text-foreground text-sm font-medium transition-colors"
              >
                Star us on GitHub →
              </a>
            </div>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}

function PricingCard({
  badge,
  title,
  price,
  priceSuffix,
  subtitle,
  features,
  cta,
  ctaHref,
  highlight = false,
}: {
  badge: string;
  title: string;
  price: string;
  priceSuffix?: string;
  subtitle: string;
  features: string[];
  cta: string;
  ctaHref: string;
  highlight?: boolean;
}) {
  return (
    <div
      className={
        highlight
          ? 'border-foreground bg-background relative flex flex-col rounded-md border-2 p-8'
          : 'border-border bg-background flex flex-col rounded-md border p-8'
      }
    >
      <div className="flex items-center justify-between">
        <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">{badge}</p>
        {highlight ? (
          <span className="bg-foreground text-background rounded-full px-3 py-1 text-xs font-medium">
            Recommended
          </span>
        ) : null}
      </div>
      <h3 className="mt-4 text-xl font-semibold">{title}</h3>
      <div className="mt-6 flex items-baseline gap-2">
        <span className="text-4xl font-semibold tracking-tight">{price}</span>
        {priceSuffix ? <span className="text-muted-foreground text-sm">{priceSuffix}</span> : null}
      </div>
      <p className="text-muted-foreground mt-2 text-sm">{subtitle}</p>
      <ul className="mt-6 space-y-3 text-sm">
        {features.map((f) => (
          <li key={f} className="flex gap-2">
            <span aria-hidden className="text-foreground/60 select-none">
              ✓
            </span>
            <span className="text-muted-foreground">{f}</span>
          </li>
        ))}
      </ul>
      <div className="mt-8">
        <Link
          href={ctaHref}
          className={buttonVariants({ size: 'lg', variant: highlight ? 'default' : 'outline' })}
        >
          {cta}
        </Link>
      </div>
    </div>
  );
}
