import * as React from 'react';

import { cn } from '../lib/cn';

export const LogoIcon = React.forwardRef<SVGSVGElement, React.SVGProps<SVGSVGElement>>(
  function LogoIcon({ className, ...props }, ref) {
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
        className={cn('h-4 w-4', className)}
        {...props}
      >
        <path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z" />
        <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
      </svg>
    );
  },
);

export interface LogoProps extends React.HTMLAttributes<HTMLSpanElement> {
  iconOnly?: boolean;
  iconClassName?: string;
  textClassName?: string;
}

export const Logo = React.forwardRef<HTMLSpanElement, LogoProps>(function Logo(
  { className, iconOnly = false, iconClassName, textClassName, ...props },
  ref,
) {
  return (
    <span
      ref={ref}
      className={cn('inline-flex items-center gap-1.5', className)}
      {...props}
    >
      <LogoIcon className={iconClassName} />
      {!iconOnly && (
        <span className={cn('font-mono text-sm font-semibold', textClassName)}>envstore</span>
      )}
    </span>
  );
});
