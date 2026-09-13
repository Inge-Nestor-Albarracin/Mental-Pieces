'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  FormEvent,
  useState,
} from 'react';

import { login } from '../../lib/api';
import Image from 'next/image';

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const [showPassword, setShowPassword] =
    useState(false);

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] =
    useState(false);

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    setError('');
    setIsLoading(true);

    try {
      const result = await login(
        email,
        password,
      );

      sessionStorage.setItem(
        'accessToken',
        result.accessToken,
      );

      router.push('/dashboard');
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(
          'Ocurrió un error inesperado.',
        );
      }
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen bg-background">
      {/* Panel izquierdo */}
      <section
        className="relative hidden overflow-hidden lg:flex lg:w-[55%]"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=1400&auto=format&fit=crop')",
          backgroundPosition: 'center',
          backgroundSize: 'cover',
        }}
      >
        {/* Capa oscura/verde */}
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(160deg, rgba(107,143,113,0.74) 0%, rgba(44,36,32,0.58) 100%)',
          }}
        />

        <div className="relative z-10 flex w-full flex-col justify-between p-12">
          {/* Marca */}
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-xl bg-white p-1.5 shadow-sm">
              <Image
                src="/mental-pieces-logo.jpeg"
                alt="Logo de Mental Pieces"
                width={48}
                height={48}
                className="h-full w-full object-contain"
                priority
              />
            </div>

            <span className="font-serif text-base font-medium tracking-wide text-white">
              Mental Pieces
            </span>
          </div>

          {/* Mensaje */}
          <div className="max-w-md">
            <blockquote className="font-serif text-3xl leading-snug italic text-white">
              &ldquo;El primer paso hacia el
              bienestar es permitirte recibir
              apoyo.&rdquo;
            </blockquote>

            <p className="mt-5 max-w-sm text-sm font-light leading-relaxed text-white/75">
              Un espacio diseñado para facilitar
              la gestión y continuidad de tu
              proceso psicológico.
            </p>

            <div className="mt-9 flex items-center gap-2 text-xs text-white/70">
              <LockIcon />

              <span>
                Acceso protegido y confidencial
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Panel derecho */}
      <section className="flex flex-1 items-center justify-center bg-card px-6 py-12 sm:px-10 lg:px-14">
        <div className="w-full max-w-[380px]">
          {/* Logo */}
          <div className="mb-10">
            <div className="w-[220px]">
            <Image
              src="/mental-pieces-logo.jpeg"
              alt="Mental Pieces by Paula Sarmiento"
              width={500}
              height={250}
              className="h-auto w-full object-contain"
              priority
            />
          </div>
                      

            <h1 className="font-serif text-3xl font-medium leading-tight text-foreground">
              Bienvenido de nuevo
            </h1>

            <p className="mt-2 text-sm text-muted-foreground">
              Inicia sesión para acceder a tu
              perfil en Mental Pieces.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
          >
            {/* Correo */}
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="text-sm font-medium text-foreground"
              >
                Correo electrónico
              </label>

              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="nombre@ejemplo.com"
                value={email}
                onChange={(event) =>
                  setEmail(event.target.value)
                }
                required
                className="w-full rounded-[10px] border border-border bg-background px-4 py-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
              />
            </div>

            {/* Contraseña */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="password"
                  className="text-sm font-medium text-foreground"
                >
                  Contraseña
                </label>

                <span className="text-xs font-medium text-accent opacity-70">
                  ¿Olvidaste tu contraseña?
                </span>
              </div>

              <div className="relative">
                <input
                  id="password"
                  type={
                    showPassword
                      ? 'text'
                      : 'password'
                  }
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value,
                    )
                  }
                  required
                  className="w-full rounded-[10px] border border-border bg-background px-4 py-3 pr-12 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/10"
                />

                <button
                  type="button"
                  onClick={() =>
                    setShowPassword(
                      (current) => !current,
                    )
                  }
                  aria-label={
                    showPassword
                      ? 'Ocultar contraseña'
                      : 'Mostrar contraseña'
                  }
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground transition hover:text-foreground"
                >
                  {showPassword ? (
                    <EyeOffIcon />
                  ) : (
                    <EyeIcon />
                  )}
                </button>
              </div>
            </div>

            {/* Error */}
            {error && (
              <div
                role="alert"
                className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            {/* Login */}
            <button
  type="submit"
  disabled={isLoading}
  className="mt-1 flex w-full items-center justify-center rounded-xl bg-[#6B8F71] px-4 py-3.5 text-sm font-semibold tracking-wide text-white shadow-sm transition duration-200 hover:bg-[#587A5E] hover:shadow-md disabled:cursor-not-allowed disabled:bg-[#AAB8AC] disabled:shadow-none"
>
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <LoadingIcon />

                  Iniciando sesión...
                </span>
              ) : (
                'Iniciar sesión'
              )}
            </button>
          </form>

          {/* Divisor */}
          <div className="my-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-border" />

            <span className="text-xs text-muted-foreground">
              o
            </span>

            <div className="h-px flex-1 bg-border" />
          </div>

          {/* Registro */}
          <div className="space-y-3">
            <Link
              href="/register"
              className="flex w-full items-center justify-center rounded-xl border-2 border-[#6B8F71] bg-transparent px-4 py-3 text-sm font-semibold text-[#587A5E] transition duration-200 hover:bg-[#EEF4EF]"
            >
              Crear una cuenta
            </Link>

            <p className="text-center text-xs text-[#7A6E66]">
              ¿Es tu primera vez en Mental Pieces?
            </p>
          </div>

          {/* Privacidad */}
          <div className="mt-10 flex items-start justify-center gap-2 text-center text-xs leading-relaxed text-muted-foreground opacity-70">
            <LockIcon />

            <p>
              Tu información se gestiona con
              criterios de privacidad y acceso
              restringido.
            </p>
          </div>
        </div>
      </section>
    </main>
  );
}

/* =========================
   ICONOS
   ========================= */

function MentalPiecesIcon({
  width = 18,
  height = 18,
  currentColor = false,
}: {
  width?: number;
  height?: number;
  currentColor?: boolean;
}) {
  const color = currentColor
    ? 'currentColor'
    : 'white';

  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 2C9.38 2 7.25 4.13 7.25 6.75c0 2.57 2.01 4.66 4.59 4.74.08-.01.16-.01.25 0 2.58-.08 4.59-2.17 4.59-4.74C16.75 4.13 14.62 2 12 2z"
        fill={color}
        opacity="0.9"
      />

      <path
        d="M17.08 14.15c-2.76-1.84-7.34-1.84-10.12 0-1.26.84-1.96 1.98-1.96 3.2 0 1.22.7 2.35 1.95 3.18 1.39.92 3.21 1.38 5.05 1.38 1.84 0 3.66-.46 5.05-1.38 1.25-.84 1.95-1.97 1.95-3.2-.01-1.22-.7-2.35-1.92-3.18z"
        fill={color}
        opacity="0.9"
      />
    </svg>
  );
}

function EyeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94" />
      <path d="M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19" />
      <line
        x1="1"
        y1="1"
        x2="23"
        y2="23"
      />
    </svg>
  );
}

function LoadingIcon() {
  return (
    <svg
      className="animate-spin"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        stroke="currentColor"
        strokeWidth="3"
        strokeDasharray="45"
        strokeDashoffset="15"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className="shrink-0"
    >
      <rect
        x="5"
        y="11"
        width="14"
        height="10"
        rx="2"
      />

      <path d="M8 11V7a4 4 0 018 0v4" />
    </svg>
  );
}