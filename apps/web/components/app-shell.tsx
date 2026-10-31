import Link from 'next/link';
import type { ReactNode } from 'react';
import { type ShellRole } from '../lib/navigation';
import { AppFooter } from './app-footer';
import { AppHeader } from './app-header';
import { PushPrompt } from './push-notifications';
import { Eyebrow, Icon } from './ui';

// Header + content + footer. The footer stays at the bottom on short pages.
export function AppShell({ role, children, width = 'wide' }: {
  role: ShellRole;
  children: ReactNode;
  width?: 'wide' | 'narrow';
}) {
  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <AppHeader role={role} />
      <main className={`mx-auto w-full flex-1 px-4 pb-4 pt-4 sm:px-6 sm:pt-6 ${width === 'narrow' ? 'max-w-4xl' : 'max-w-6xl'}`}>
        <PushPrompt />
        {children}
      </main>
      <AppFooter role={role} />
    </div>
  );
}

export function BackLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="mb-2 inline-flex min-h-11 items-center gap-2 rounded-lg text-sm font-bold text-forest hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
      <Icon name="back" size={17} /> {children}
    </Link>
  );
}

export function PageIntro({ kicker, title, description, actions }: {
  kicker?: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-2xl">
        {kicker && <Eyebrow>{kicker}</Eyebrow>}
        <h1 className="mt-2 font-serif text-4xl font-normal leading-tight tracking-tight text-foreground sm:text-[44px]">{title}</h1>
        {description && <p className="mt-2 text-sm leading-relaxed text-ink-soft sm:text-base">{description}</p>}
      </div>
      {actions && <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">{actions}</div>}
    </div>
  );
}
