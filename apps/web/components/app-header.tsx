'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';

export function AppHeader() {
  const router = useRouter();

  function logout() {
    sessionStorage.removeItem('accessToken');
    router.push('/login');
  }

  return (
    <header className="border-b border-[#E1D9D0] bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <button
          type="button"
          onClick={() => router.push('/dashboard')}
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

        <nav className="flex items-center gap-2 sm:gap-3">
          <button
            type="button"
            onClick={() => router.push('/dashboard')}
            className="rounded-lg px-3 py-2 text-sm font-medium text-[#4A3F38] transition hover:bg-[#F1ECE6]"
          >
            Inicio
          </button>

          <button
            type="button"
            onClick={() => router.push('/profile')}
            className="rounded-lg px-3 py-2 text-sm font-medium text-[#4A3F38] transition hover:bg-[#F1ECE6]"
          >
            Perfil
          </button>

          <button
            type="button"
            onClick={logout}
            className="rounded-lg border border-[#C9BFB5] px-3 py-2 text-sm font-medium text-[#6B5E55] transition hover:bg-[#F5F0EB]"
          >
            Salir
          </button>
        </nav>
      </div>
    </header>
  );
}