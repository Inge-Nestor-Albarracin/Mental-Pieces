import Link from 'next/link';
import type { ReactNode } from 'react';

// Shared visual building blocks (design reference: soft forest greens, eyebrows, date blocks).

export type IconName =
  | 'arrow' | 'calendar' | 'calendarPlus' | 'check' | 'clock' | 'heart' | 'menu' | 'profile'
  | 'shield' | 'x' | 'users' | 'bell' | 'notes' | 'refresh' | 'trash' | 'plus' | 'edit'
  | 'alert' | 'back' | 'logout' | 'repeat' | 'link' | 'userPlus' | 'eye' | 'eyeOff';

const PATHS: Record<IconName, ReactNode> = {
  arrow: <><path d="M5 12h14" /><path d="m13 6 6 6-6 6" /></>,
  back: <><path d="M19 12H5" /><path d="m11 18-6-6 6-6" /></>,
  calendar: <><rect width="18" height="16" x="3" y="5" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  calendarPlus: <><rect width="18" height="16" x="3" y="5" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M12 13v5M9.5 15.5h5" /></>,
  check: <><path d="M20 11.5V12a8 8 0 1 1-4.75-7.32" /><path d="m9 11 3 3L22 4" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8l1.1 1.1L12 21l7.8-7.5 1.1-1.1a5.5 5.5 0 0 0-.1-7.8Z" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  profile: <><circle cx="12" cy="8" r="4" /><path d="M4.5 21a7.5 7.5 0 0 1 15 0" /></>,
  shield: <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z" /><path d="m9 12 2 2 4-4" /></>,
  x: <path d="m6 6 12 12M18 6 6 18" />,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6" /></>,
  bell: <><path d="M6 8a6 6 0 1 1 12 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  notes: <><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></>,
  refresh: <><path d="M20 11a8 8 0 0 0-14.7-4.4L4 8" /><path d="M4 3v5h5M4 13a8 8 0 0 0 14.7 4.4L20 16" /><path d="M20 21v-5h-5" /></>,
  trash: <><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  edit: <><path d="M4 20h4L19 9l-4-4L4 16z" /><path d="m13.5 6.5 4 4" /></>,
  alert: <><path d="M12 3 2 20h20z" /><path d="M12 10v4M12 17.5v.01" /></>,
  logout: <><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3" /><path d="M10 17l-5-5 5-5M5 12h11" /></>,
  repeat: <><path d="M17 2l4 4-4 4" /><path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" /><path d="M21 13v2a3 3 0 0 1-3 3H3" /></>,
  link: <><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" /><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" /></>,
  userPlus: <><circle cx="10" cy="8" r="4" /><path d="M3 21a7 7 0 0 1 14 0M19 8v6M16 11h6" /></>,
  eye: <><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  eyeOff: <><path d="M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-2.2 3.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2M3 3l18 18" /></>,
};

export function Icon({ name, size = 20, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg aria-hidden="true" fill="none" width={size} height={size} viewBox="0 0 24 24" className={className}>
      <g stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.8">{PATHS[name]}</g>
    </svg>
  );
}

export function Eyebrow({ children, light = false }: { children: ReactNode; light?: boolean }) {
  return (
    <span className={`eyebrow ${light ? 'text-white/80' : ''}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sun" />
      {children}
    </span>
  );
}

export function Hero({ eyebrow, title, description, actions, note }: {
  eyebrow: string;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  note?: { title: string; text: string; icon?: IconName };
}) {
  return (
    <section className="hero px-6 pb-8 pt-10 sm:px-12 sm:py-14">
      <span aria-hidden="true" className="hero-ring -right-24 -top-36 h-[340px] w-[340px]" />
      <span aria-hidden="true" className="hero-ring -bottom-36 right-36 h-[210px] w-[210px]" />
      <div className="relative z-10 max-w-2xl">
        <Eyebrow light>{eyebrow}</Eyebrow>
        <h1 className="mt-3 font-serif text-4xl font-normal leading-tight tracking-tight sm:text-5xl">{title}</h1>
        {description && <p className="mt-3 max-w-xl text-base leading-relaxed text-white/80">{description}</p>}
        {actions && <div className="mt-7 flex flex-col gap-3 sm:flex-row">{actions}</div>}
      </div>
      {note && (
        <div className="relative z-10 mt-8 flex w-fit items-center gap-3 rounded-[15px] border border-white/15 bg-[rgba(30,47,37,0.3)] px-4 py-3 text-white/80 backdrop-blur md:absolute md:bottom-7 md:right-8 md:mt-0">
          <Icon name={note.icon ?? 'heart'} size={19} className="text-[#f4cac1]" />
          <span className="flex flex-col text-xs">
            <strong className="text-sm text-white">{note.title}</strong>
            {note.text}
          </span>
        </div>
      )}
    </section>
  );
}

export function SectionHeading({ eyebrow, title, id, action }: { eyebrow: string; title: string; id?: string; action?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 id={id} className="mt-1.5 font-serif text-2xl font-normal tracking-tight sm:text-3xl">{title}</h2>
      </div>
      {action}
    </div>
  );
}

export function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="inline-flex min-h-11 items-center gap-2 text-sm font-bold text-forest hover:underline">
      {children} <Icon name="arrow" size={17} />
    </Link>
  );
}

export function QuickCard({ href, icon, title, description, badge }: {
  href: string;
  icon: IconName;
  title: string;
  description: string;
  badge?: ReactNode;
}) {
  return (
    <Link href={href} className="quick-card group">
      <span className="icon-box"><Icon name={icon} size={23} /></span>
      <span className="flex min-w-0 flex-col gap-1">
        <strong className="flex flex-wrap items-center gap-2 text-[15px] text-foreground">{title}{badge}</strong>
        <small className="text-xs leading-relaxed text-ink-soft">{description}</small>
      </span>
      <span className="text-primary transition group-hover:translate-x-1"><Icon name="arrow" size={18} /></span>
    </Link>
  );
}

const MONTHS = ['ENE', 'FEB', 'MAR', 'ABR', 'MAY', 'JUN', 'JUL', 'AGO', 'SEP', 'OCT', 'NOV', 'DIC'];

// Calendar date (YYYY-MM-DD) shown as "OCT / 16" without any timezone conversion.
export function DateBlock({ date, tone = 'mint' }: { date: string; tone?: 'mint' | 'amber' | 'muted' }) {
  const [, month, day] = date.split('-').map(Number);
  const toneClass = tone === 'amber' ? 'bg-amber-50 text-amber-900 ring-1 ring-amber-300' : tone === 'muted' ? 'bg-muted text-ink-soft' : '';
  return (
    <div className={`date-block ${toneClass}`} aria-hidden="true">
      <span className="text-[11px] font-bold tracking-[0.12em]">{MONTHS[month - 1] ?? ''}</span>
      <strong className="font-serif text-[34px] font-normal leading-none">{day || ''}</strong>
    </div>
  );
}

export type PillTone = 'green' | 'blue' | 'amber' | 'red' | 'gray' | 'violet';

const PILL: Record<PillTone, string> = {
  green: 'bg-[#edf5ee] text-forest [--dot:#4f9a5f]',
  blue: 'bg-sky-50 text-sky-900 [--dot:#2b8bb0]',
  amber: 'bg-amber-50 text-amber-900 ring-1 ring-amber-300 [--dot:#d99a12]',
  red: 'bg-red-50 text-red-800 [--dot:#d64545]',
  gray: 'bg-muted text-ink-soft [--dot:#8a8f8b]',
  violet: 'bg-violet-50 text-violet-900 [--dot:#8b5cc4]',
};

export function StatusPill({ tone, children }: { tone: PillTone; children: ReactNode }) {
  return (
    <span className={`inline-flex w-fit shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 font-sans text-xs font-bold tracking-normal ${PILL[tone]}`}>
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[var(--dot)]" />
      {children}
    </span>
  );
}

export function EmptyState({ icon = 'calendar', title, text, action }: { icon?: IconName; title: string; text: string; action?: ReactNode }) {
  return (
    <section className="flex flex-col items-start gap-3 rounded-[22px] border border-dashed border-[rgba(54,91,69,0.25)] bg-paper/70 p-6 sm:flex-row sm:items-center">
      <span className="icon-box"><Icon name={icon} size={22} /></span>
      <div className="flex-1">
        <h2 className="font-serif text-xl">{title}</h2>
        <p className="mt-1 text-sm text-ink-soft">{text}</p>
      </div>
      {action}
    </section>
  );
}

export function Notice({ tone, children }: { tone: 'success' | 'warning'; children: ReactNode }) {
  return (
    <p role="status" className={`mb-4 flex items-start gap-3 rounded-2xl border p-4 text-sm ${tone === 'success' ? 'border-[#c9dacb] bg-mint text-forest-deep' : 'border-amber-300 bg-amber-50 text-amber-950'}`}>
      <Icon name={tone === 'success' ? 'check' : 'alert'} size={19} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
