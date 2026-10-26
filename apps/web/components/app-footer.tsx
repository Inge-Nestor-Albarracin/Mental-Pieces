import Image from 'next/image';
import Link from 'next/link';
import { NAV_LINKS, homeHref, type ShellRole } from '../lib/navigation';
import { InstallAppButton } from './pwa';
import { Icon } from './ui';

export function AppFooter({ role }: { role: ShellRole }) {
  return (
    <footer className="safe-bottom mt-16 bg-forest-deep text-white/70">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-5 pb-10 pt-12 sm:px-6 md:grid-cols-[1.3fr_0.7fr_1.2fr]">
        <div>
          <Link href={homeHref(role)} aria-label="Mental Pieces, ir al inicio" className="inline-block rounded-xl bg-white px-2 py-1">
            <Image src="/icons/wordmark.png" alt="Mental Pieces" width={560} height={269} className="h-10 w-auto" />
          </Link>
          <p className="mt-5 max-w-sm text-sm leading-relaxed">
            Un espacio seguro para organizar la atención psicológica y acompañar cada etapa del proceso.
          </p>
          <InstallAppButton onDark className="mt-5 w-full sm:w-auto" />
        </div>

        <nav aria-label="Enlaces del pie de página" className="flex flex-col items-start gap-3 text-sm">
          <strong className="mb-1 text-white">Plataforma</strong>
          {NAV_LINKS[role].map(([href, label]) => (
            <Link key={href} href={href} className="inline-flex min-h-8 items-center hover:text-white hover:underline">{label}</Link>
          ))}
        </nav>

        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/10 text-[#b8d0bf]"><Icon name="shield" size={22} /></span>
            <span className="flex flex-col gap-1.5">
              <strong className="text-sm text-white">Tu privacidad importa</strong>
              <small className="text-xs leading-relaxed">Tu información se gestiona con criterios de privacidad y acceso restringido.</small>
            </span>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-[#f4c85d]/40 bg-[#f4c85d]/10 p-4">
            <span className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#f4c85d]/20 text-[#f4c85d]"><Icon name="alert" size={22} /></span>
            <span className="flex flex-col gap-1.5">
              <strong className="text-sm text-white">¿Es una emergencia?</strong>
              <small className="text-xs leading-relaxed">Mental Pieces no atiende emergencias. Si tú o alguien más está en riesgo, llama de inmediato a la línea <a href="tel:123" className="font-bold text-white underline">123</a>.</small>
            </span>
          </div>
        </div>
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-2 border-t border-white/10 px-5 py-5 text-xs sm:flex-row sm:justify-between sm:px-6">
        <span>© {new Date().getFullYear()} Mental Pieces · by Paula Sarmiento</span>
        <span>Horarios en hora de Colombia (Bogotá)</span>
      </div>
    </footer>
  );
}
