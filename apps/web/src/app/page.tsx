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

const inlineCode = 'bg-muted text-foreground rounded px-1 py-0.5 font-mono text-[0.85em]';

const monorepoConfigExample = `{
  "workspace": "shinra",
  "files": [
    { "path": "apps/web/.env.local",   "project": "shinra-web",    "environment": "development" },
    { "path": "apps/api/.env",         "project": "shinra-api",    "environment": "development" },
    { "path": "apps/worker/.env",      "project": "shinra-worker", "environment": "development" }
  ]
}`;

const monorepoCliExample = `$ envstore init
Found 3 .env files. Group them as a monorepo? Y
Group name: shinra
  shinra-web    -> apps/web/.env.local
  shinra-api    -> apps/api/.env
  shinra-worker -> apps/worker/.env
Wrote envstore.json (3 files).

$ envstore push           # encrypts & uploads every file
$ envstore push apps/web  # path-prefix filter
$ envstore sync           # reconcile when files change
`;

const monorepoBullets: Array<{ key: string; node: React.ReactNode }> = [
  {
    key: 'init',
    node: (
      <>
        <code className={inlineCode}>envstore init</code> walks the tree and proposes one project
        per .env file it finds
      </>
    ),
  },
  {
    key: 'apps',
    node: <>Apps stay as separate projects — apps/web is not an environment of apps/api</>,
  },
  {
    key: 'groups',
    node: (
      <>
        Project groups cluster monorepo siblings together in the dashboard and CLI listings
      </>
    ),
  },
  {
    key: 'filters',
    node: (
      <>
        <code className={inlineCode}>push</code> and <code className={inlineCode}>pull</code>{' '}
        filter by path prefix, <code className={inlineCode}>--project</code>, or{' '}
        <code className={inlineCode}>--env</code>
      </>
    ),
  },
  {
    key: 'sync',
    node: (
      <>
        <code className={inlineCode}>envstore sync</code> reconciles envstore.json with the
        filesystem, with <code className={inlineCode}>--dry-run</code> and{' '}
        <code className={inlineCode}>--prune</code> modes
      </>
    ),
  },
  {
    key: 'link',
    node: (
      <>
        <code className={inlineCode}>envstore link &lt;code&gt;</code> offers to register every
        .env file when joining an existing workspace
      </>
    ),
  },
];

const alsoShipped: Array<{ title: string; body: string }> = [
  {
    title: 'Service tokens for CI',
    body: `"envstore token create" generates an X25519 keypair on your runner — the private key never leaves the box. Tokens get their own public recipient, so every push encrypts to CI alongside humans.`,
  },
  {
    title: 'GitHub Action',
    body: `A composite action wraps "envstore pull" for workflows. Installs the pinned release binary, verifies it against the sha256 sidecar, and runs the pull with ENVSTORE_TOKEN + ENVSTORE_IDENTITY.`,
  },
  {
    title: 'Audit log viewer',
    body: `Every push and pull is recorded with timestamp, actor, and resource. Human members and CI tokens are attributed distinctly so the dashboard tells you at a glance which was which.`,
  },
  {
    title: 'envstore rekey',
    body: `Teammate joined or a token rotated? "envstore rekey" walks every (project, env) reachable from envstore.json and re-encrypts to the workspace's current recipient set.`,
  },
];

const comparison: Array<{ row: string; envstore: string; others: string }> = [
  { row: 'Pricing', envstore: `$${priceDollars} / workspace`, others: '$5–21 / user / month' },
  { row: 'Team members', envstore: 'Unlimited', others: 'Per-seat' },
  {
    row: 'Monorepo support',
    envstore: 'One envstore.json — init walks every .env',
    others: 'One project per service, set up by hand',
  },
  {
    row: 'Server can decrypt your files',
    envstore: 'No. By construction.',
    others: 'Yes — "encrypted at rest"',
  },
  {
    row: 'Compromised API can read your next push',
    envstore: 'No — CLI checks the recipient set first',
    others: 'Yes — server already had the key',
  },
  { row: 'Key custody', envstore: 'You hold the key', others: 'Vendor holds the key' },
  {
    row: 'Web dashboard can leak secrets',
    envstore: 'No — no decrypt path exists',
    others: 'XSS / session theft',
  },
  {
    row: 'Runtime integration',
    envstore: 'Writes a plain .env — your app reads it like always',
    others: '"vendor run -- your-app" wrapper or SDK injection',
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
    q: `What stops a compromised envstore from quietly adding its own key to your next push?`,
    a: (
      <>
        Nothing server-side — which is exactly why the CLI does. Every workstation caches the
        recipients it has encrypted to. If our API ever returns a public key your CLI hasn't seen
        before — an attacker's, ours, anyone's — your push flags the new entry and waits for you to
        confirm before encrypting. In CI the push fails outright unless you've passed{' '}
        <code className={inlineCode}>--trust-new</code>. The &ldquo;compromised server silently adds
        a key to read future pushes&rdquo; attack is real in every end-to-end-encrypted vault that
        takes the server's recipient list on faith. envstore doesn't.
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
    q: `My repo has six services in it. Do I have to register them by hand?`,
    a: (
      <>
        No. <code className={inlineCode}>envstore init</code> walks your tree, lists every .env
        file it finds, and registers all of them in one go. Each app becomes its own project (so
        secrets stay scoped) but they share a group, so the dashboard shows them as a single
        monorepo at a glance. After that,{' '}
        <code className={inlineCode}>envstore push</code> with no arguments encrypts and uploads
        every file;{' '}
        <code className={inlineCode}>envstore push apps/web</code> narrows by path. When you add
        a new .env tomorrow, <code className={inlineCode}>envstore sync</code> pulls it into the
        config.
      </>
    ),
  },
  {
    q: `How do I get secrets into CI without burning a real user identity?`,
    a: (
      <>
        Mint a workspace service token. The CLI generates the X25519 keypair on your laptop,
        registers the public part, and hands you the bearer token once. Pass{' '}
        <code className={inlineCode}>ENVSTORE_TOKEN</code> and{' '}
        <code className={inlineCode}>ENVSTORE_IDENTITY</code> as secrets to your runner — or use
        the bundled GitHub Action, which installs the binary (sha256-verified) and runs the pull
        for you. Tokens can't mint other tokens or change ACL, so the blast radius of a leak is
        the workspace's current ciphertext, nothing more.
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
              href="#monorepos"
              className="text-muted-foreground hover:text-foreground hidden transition-colors sm:inline"
            >
              Monorepos
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
              className="mt-12 min-w-0"
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

        <section id="monorepos" className="border-border border-b">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              Just shipped
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Built for monorepos.
            </h2>
            <p className="text-muted-foreground mt-6 max-w-2xl text-pretty">
              One <code className={inlineCode}>envstore.json</code> at the root of your repo, every{' '}
              <em>.env</em> file in it — apps, services, workers, whatever shape your repo has.{' '}
              <code className={inlineCode}>envstore init</code> walks the tree, registers one
              project per file, and tags them with a shared group so the dashboard renders the
              monorepo as a single thing.
            </p>

            <div className="mt-10 grid gap-6 lg:grid-cols-2">
              <div className="min-w-0">
                <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                  envstore.json
                </p>
                <CodeBlock
                  className="mt-3 w-full min-w-0"
                  code={monorepoConfigExample}
                  copyable={false}
                />
              </div>
              <div className="min-w-0">
                <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
                  init detects, push moves everything
                </p>
                <CodeBlock
                  className="mt-3 w-full min-w-0"
                  code={monorepoCliExample}
                  copyable={false}
                />
              </div>
            </div>

            <ul className="mt-10 grid gap-3 text-sm sm:grid-cols-2">
              {monorepoBullets.map((b) => (
                <li key={b.key} className="text-muted-foreground flex gap-2">
                  <span aria-hidden className="text-foreground/60 select-none">
                    ✓
                  </span>
                  <span>{b.node}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="border-border bg-muted/20 border-b">
          <div className="mx-auto max-w-6xl px-6 py-20">
            <p className="text-muted-foreground font-mono text-xs uppercase tracking-widest">
              Also new
            </p>
            <h2 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
              Wired into how your team actually deploys.
            </h2>
            <p className="text-muted-foreground mt-4 max-w-2xl">
              Monorepo support is the headline. The rest of this week's ship list is the
              operational glue around it — CI, audit, recovery.
            </p>
            <div className="mt-12 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
              {alsoShipped.map((f) => (
                <div key={f.title} className="border-border bg-background rounded-md border p-6">
                  <h3 className="text-base font-semibold">{f.title}</h3>
                  <p className="text-muted-foreground mt-3 text-sm leading-relaxed">{f.body}</p>
                </div>
              ))}
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
              Bring the intern. Every new workspace gets a {PRICING.trialDays}-day free trial.
            </p>
            <div className="mt-12 rounded-md border-2 border-foreground bg-background p-8 sm:p-10">
              <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:items-center">
                <div>
                  <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
                    Per workspace
                  </p>
                  <div className="mt-4 flex items-baseline gap-2">
                    <span className="text-6xl font-semibold tracking-tight">
                      ${priceDollars}
                    </span>
                    <span className="text-base text-muted-foreground">/ month</span>
                  </div>
                  <p className="mt-4 text-sm text-muted-foreground">
                    Flat fee — unlimited members. {PRICING.trialDays}-day free trial,
                    no card required.
                  </p>
                  <Link
                    href="/login"
                    className={`${buttonVariants({ size: 'lg' })} mt-6 w-full sm:w-auto`}
                  >
                    Start {PRICING.trialDays}-day free trial
                  </Link>
                </div>
                <ul className="grid gap-3 text-sm md:border-l md:border-border md:pl-10 sm:grid-cols-2">
                  {[
                    'Monorepo-aware — one config, every .env in the repo',
                    'Unlimited projects & environments',
                    'Unlimited members (no per-seat charge)',
                    'Multi-recipient encryption — every member can decrypt',
                    'Service tokens + GitHub Action for CI/CD',
                    'Audit log of every push & pull',
                    `${DEFAULTS.softDeleteRetentionDays}-day soft-delete window`,
                    'Personal workspace at /me + as many team workspaces as you want',
                    'Cancel anytime — see refund policy',
                  ].map((f) => (
                    <li key={f} className="flex gap-2">
                      <span aria-hidden className="select-none text-foreground/60">
                        ✓
                      </span>
                      <span className="text-muted-foreground">{f}</span>
                    </li>
                  ))}
                </ul>
              </div>
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

