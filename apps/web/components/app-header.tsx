'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { NAV_LINKS, ROLE_LABEL, homeHref, type ShellRole } from '../lib/navigation';
import { Icon } from './ui';

function isCurrent(pathname: string, href: string, home: string): boolean {
  if (pathname === href) return true;
  // Nested routes highlight their section, except "Inicio" and sibling sections with their own entry.
  return href !== home && href !== '/appointments' && pathname.startsWith(`${href}/`);
}

export function AppHeader({ role = 'PATIENT' }: { role?: ShellRole }) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const home = homeHref(role);
  const links = NAV_LINKS[role];

  function logout() {
    sessionStorage.removeItem('accessToken');
    router.replace('/login');
  }

  const linkClass = 'inline-flex min-h-11 items-center rounded-[11px] px-4 py-2 text-sm font-semibold text-ink-soft transition hover:-translate-y-px hover:bg-mint hover:text-forest aria-[current=page]:bg-mint aria-[current=page]:text-forest-deep aria-[current=page]:shadow-[inset_0_0_0_1px_rgba(54,91,69,0.08)]';

  return (
    <header className="safe-top sticky top-0 z-40 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/75">
      <div className="relative mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href={home} aria-label="Mental Pieces, ir al inicio" className="flex shrink-0 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest">
          <span className="block rounded-xl bg-white px-2 py-1 shadow-sm ring-1 ring-border">
            <Image src="/icons/wordmark.png" alt="Mental Pieces" width={560} height={269} priority className="h-9 w-auto sm:h-10" />
          </span>
          <span className="hidden text-xs font-bold uppercase tracking-[0.12em] text-[#5f8069] xl:block">{ROLE_LABEL[role]}</span>
        </Link>

        <nav aria-label="Navegación principal" className="hidden items-center gap-1.5 rounded-2xl border border-[rgba(54,91,69,0.1)] bg-paper/75 p-1.5 lg:flex">
          {links.map(([href, label]) => (
            <Link key={href} href={href} aria-current={isCurrent(pathname, href, home) ? 'page' : undefined} className={linkClass}>{label}</Link>
          ))}
          <span aria-hidden="true" className="mx-0.5 h-6 w-px bg-border" />
          <button type="button" onClick={logout} className="inline-flex min-h-11 items-center gap-2 rounded-[11px] px-4 py-2 text-sm font-semibold text-[#8e514c] transition hover:bg-red-50">
            <Icon name="logout" size={17} /> Salir
          </button>
        </nav>

        <button type="button" onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-controls="mobile-nav"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-paper text-forest lg:hidden">
          <Icon name={open ? 'x' : 'menu'} size={23} />
        </button>

        {open && (
          <nav id="mobile-nav" aria-label="Navegación principal" className="absolute right-4 top-full z-50 mt-1 w-[min(280px,calc(100vw-2rem))] rounded-[17px] border border-border bg-paper p-2.5 shadow-[var(--shadow-lift)] sm:right-6 lg:hidden">
            <p className="px-3 pb-2 pt-1 text-xs font-bold uppercase tracking-[0.12em] text-[#5f8069]">{ROLE_LABEL[role]}</p>
            <ul className="flex flex-col gap-1">
              {links.map(([href, label]) => (
                <li key={href}>
                  <Link href={href} onClick={() => setOpen(false)} aria-current={isCurrent(pathname, href, home) ? 'page' : undefined} className={`${linkClass} w-full`}>{label}</Link>
                </li>
              ))}
              <li aria-hidden="true" className="my-1 h-px bg-border" />
              <li>
                <button type="button" onClick={logout} className="inline-flex min-h-11 w-full items-center gap-2 rounded-[11px] px-4 py-2 text-sm font-semibold text-[#8e514c] hover:bg-red-50">
                  <Icon name="logout" size={17} /> Cerrar sesión
                </button>
              </li>
            </ul>
          </nav>
        )}
      </div>
    </header>
  );
}
