'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';

export function AppHeader({ role = 'PATIENT' }: { role?: 'PATIENT' | 'PSYCHOLOGIST' }) {
  const router = useRouter();
  const pathname = usePathname();
  const home = role === 'PSYCHOLOGIST' ? '/psychologist/dashboard' : '/dashboard';
  const links = role === 'PSYCHOLOGIST'
    ? [[home, 'Inicio'], ['/psychologist/appointments', 'Mi agenda'], ['/psychologist/availability', 'Mi disponibilidad']]
    : [[home, 'Inicio'], ['/appointments', 'Mis citas'], ['/appointments/new', 'Agendar cita'], ['/profile', 'Perfil']];

  function logout() {
    sessionStorage.removeItem('accessToken');
    router.replace('/login');
  }

  return (
    <header className="border-b border-[#E1D9D0] bg-white">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-3 px-4 py-3 sm:flex-row sm:items-center sm:px-6">
        <button
          type="button"
          onClick={() => router.push(home)}
          className="shrink-0"
          aria-label="Ir al inicio"
        >
          <Image
            src="/mental-pieces-logo.jpeg"
            alt="Mental Pieces"
            width={180}
            height={90}
            className="h-auto w-[140px] object-contain sm:w-[165px]"
            priority
          />
        </button>

        <nav aria-label="Navegación principal" className="flex flex-wrap items-center gap-2 sm:justify-end sm:gap-3">
          {links.map(([href, label]) => (
            <Link key={href} href={href} aria-current={pathname === href ? 'page' : undefined}
              className="inline-flex min-h-11 items-center rounded-lg px-3 py-2 text-sm font-medium text-[#4A3F38] transition hover:bg-[#F1ECE6] aria-[current=page]:bg-[#F1ECE6]">
              {label}
            </Link>
          ))}

          <button
            type="button"
            onClick={logout}
            className="min-h-11 rounded-lg border border-[#C9BFB5] px-3 py-2 text-sm font-medium text-[#6B5E55] transition hover:bg-[#F5F0EB]"
          >
            Salir
          </button>
        </nav>
      </div>
    </header>
  );
}
