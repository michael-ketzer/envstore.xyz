'use client';

import { useState } from 'react';

import { Check, Copy } from 'lucide-react';

import { cn } from '@envstore/ui';

export function CodeBlock({
  code,
  copyText,
  className,
  label = 'Copy command',
  copyable = true,
}: {
  code: string;
  copyText?: string;
  className?: string;
  label?: string;
  // Some blocks are illustrative — example config files, simulated terminal
  // sessions — where a copy button is misleading (the user would be copying
  // placeholders or shell output, not a runnable command). Pass copyable=false
  // to omit the button and reclaim the right padding for the content.
  copyable?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(copyText ?? code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API blocked (insecure context, permission denied) — leave the visual unchanged.
    }
  };

  return (
    <div
      className={cn(
        // Width: shrink to fit the code, but never narrower than half of the
        // parent (keeps short commands from looking like a tiny pill) and
        // never wider than the parent. Override `min-w-*` on the landing page
        // when you want a snug "fit-content only" pill.
        'group relative w-fit min-w-[50%] max-w-full overflow-hidden rounded-md border border-border bg-muted/40',
        className,
      )}
    >
      <pre
        className={cn(
          'overflow-x-auto whitespace-pre px-4 py-3 font-mono text-xs leading-relaxed text-foreground/90',
          copyable && 'pr-12',
        )}
      >
        <code>{code}</code>
      </pre>
      {copyable ? (
        <button
          type="button"
          onClick={onCopy}
          aria-label={copied ? 'Copied' : label}
          title={copied ? 'Copied' : label}
          className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded border border-border bg-background/80 text-muted-foreground transition-colors hover:bg-background hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1"
        >
          {copied ? (
            <Check className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Copy className="h-3.5 w-3.5" aria-hidden />
          )}
        </button>
      ) : null}
    </div>
  );
}
