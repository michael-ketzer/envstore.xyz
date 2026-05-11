import Link from 'next/link';

const tabs = [
  { href: '/dashboard/account', label: 'Profile' },
  { href: '/dashboard/account/cli-sessions', label: 'CLI sessions' },
  { href: '/dashboard/account/recipients', label: 'Recipients' },
];

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Account</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your sign-in, CLI sessions, and registered encryption keys.
        </p>
      </header>
      <nav className="flex flex-wrap gap-3 border-b border-border text-sm">
        {tabs.map((tab) => (
          <Link
            key={tab.href}
            href={tab.href}
            className="border-b-2 border-transparent pb-2 text-muted-foreground hover:border-foreground hover:text-foreground"
          >
            {tab.label}
          </Link>
        ))}
      </nav>
      {children}
    </div>
  );
}
