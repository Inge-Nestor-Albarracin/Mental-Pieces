'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type { FormEvent } from 'react';

import { registerPatient } from '../../lib/api';

export default function RegisterPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] =
    useState('');

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

    if (password !== confirmPassword) {
      setError(
        'Las contraseñas no coinciden.',
      );
      return;
    }

    setIsLoading(true);

    try {
      await registerPatient(
        email,
        password,
      );

      router.push('/login');
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
    <main className="flex min-h-screen bg-[#F5F0EB]">
      {/* Panel visual: solo escritorio */}
      <section
        className="relative hidden overflow-hidden lg:flex lg:w-[50%]"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1544367567-0f2fcb009e0b?w=1400&auto=format&fit=crop')",
          backgroundPosition: 'center',
          backgroundSize: 'cover',
        }}
      >
        <div
          className="absolute inset-0"
          style={{
            background:
              'linear-gradient(160deg, rgba(107,143,113,0.76) 0%, rgba(44,36,32,0.62) 100%)',
          }}
        />

        <div className="relative z-10 flex w-full flex-col justify-between p-12">
          <div className="w-[220px] overflow-hidden rounded-xl bg-white/95 p-2 shadow-sm">
            <Image
              src="/mental-pieces-logo.jpeg"
              alt="Mental Pieces by Paula Sarmiento"
              width={600}
              height={300}
              className="h-auto w-full object-contain"
              priority
            />
          </div>

          <div className="max-w-md">
            <blockquote className="font-serif text-3xl leading-snug italic text-white">
              &ldquo;Cada proceso comienza con
              un primer paso.&rdquo;
            </blockquote>

            <p className="mt-5 max-w-sm text-sm font-light leading-relaxed text-white/80">
              Crea tu cuenta para gestionar tu
              información y acceder a los
              servicios disponibles en Mental
              Pieces.
            </p>

            <div className="mt-9 flex items-center gap-2 text-xs text-white/75">
              <LockIcon />

              <span>
                Acceso protegido y confidencial
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Formulario */}
      <section className="flex min-h-screen flex-1 items-center justify-center bg-[#FAF7F4] px-5 py-8 sm:px-8 sm:py-10 lg:min-h-0 lg:px-14 lg:py-12">
        <div className="w-full max-w-[400px]">
          <div className="mb-8">
            <div className="mb-6 w-[190px] sm:w-[230px]">
              <Image
                src="/mental-pieces-logo.jpeg"
                alt="Mental Pieces by Paula Sarmiento"
                width={600}
                height={300}
                className="h-auto w-full object-contain"
                priority
              />
            </div>

            <h1 className="font-serif text-2xl font-medium leading-tight text-[#2C2420] sm:text-3xl">
              Crear una cuenta
            </h1>

            <p className="mt-2 text-sm leading-relaxed text-[#7A6E66]">
              Regístrate como paciente para
              comenzar a utilizar Mental Pieces.
            </p>
          </div>

          <form
            onSubmit={handleSubmit}
            className="flex flex-col gap-5"
          >
            <div className="flex flex-col gap-2">
              <label
                htmlFor="email"
                className="text-sm font-medium text-[#2C2420]"
              >
                Correo electrónico
              </label>

              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="nombre@ejemplo.com"
                required
                value={email}
                onChange={(event) =>
                  setEmail(
                    event.target.value,
                  )
                }
                className="w-full rounded-xl border border-[#D8D0C7] bg-white px-4 py-3 text-sm text-[#2C2420] outline-none transition duration-200 placeholder:text-[#A79D95] focus:border-[#6B8F71] focus:ring-4 focus:ring-[#6B8F71]/10"
              />
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="password"
                className="text-sm font-medium text-[#2C2420]"
              >
                Contraseña
              </label>

              <div className="relative">
                <input
                  id="password"
                  type={
                    showPassword
                      ? 'text'
                      : 'password'
                  }
                  autoComplete="new-password"
                  placeholder="Mínimo 8 caracteres"
                  required
                  minLength={8}
                  maxLength={72}
                  value={password}
                  onChange={(event) =>
                    setPassword(
                      event.target.value,
                    )
                  }
                  className="w-full rounded-xl border border-[#D8D0C7] bg-white px-4 py-3 pr-12 text-sm text-[#2C2420] outline-none transition duration-200 placeholder:text-[#A79D95] focus:border-[#6B8F71] focus:ring-4 focus:ring-[#6B8F71]/10"
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
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-[#7A6E66] transition hover:text-[#2C2420]"
                >
                  {showPassword ? (
                    <EyeOffIcon />
                  ) : (
                    <EyeIcon />
                  )}
                </button>
              </div>

              <p className="text-xs text-[#8A7E75]">
                Debe contener entre 8 y 72
                caracteres.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <label
                htmlFor="confirmPassword"
                className="text-sm font-medium text-[#2C2420]"
              >
                Confirmar contraseña
              </label>

              <input
                id="confirmPassword"
                type={
                  showPassword
                    ? 'text'
                    : 'password'
                }
                autoComplete="new-password"
                placeholder="Repite tu contraseña"
                required
                value={confirmPassword}
                onChange={(event) =>
                  setConfirmPassword(
                    event.target.value,
                  )
                }
                className="w-full rounded-xl border border-[#D8D0C7] bg-white px-4 py-3 text-sm text-[#2C2420] outline-none transition duration-200 placeholder:text-[#A79D95] focus:border-[#6B8F71] focus:ring-4 focus:ring-[#6B8F71]/10"
              />
            </div>

            {error && (
              <div
                role="alert"
                className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading}
              className="mt-1 flex w-full items-center justify-center rounded-xl bg-[#6B8F71] px-4 py-3.5 text-sm font-semibold text-white shadow-sm transition duration-200 hover:bg-[#587A5E] hover:shadow-md disabled:cursor-not-allowed disabled:bg-[#AAB8AC] disabled:shadow-none"
            >
              {isLoading
                ? 'Creando cuenta...'
                : 'Crear cuenta'}
            </button>
          </form>

          <div className="my-7 flex items-center gap-3">
            <div className="h-px flex-1 bg-[#DDD5CA]" />

            <span className="text-xs font-medium text-[#8A7E75]">
              o
            </span>

            <div className="h-px flex-1 bg-[#DDD5CA]" />
          </div>

          <Link
            href="/login"
            className="flex w-full items-center justify-center rounded-xl border-2 border-[#6B8F71] px-4 py-3 text-sm font-semibold text-[#587A5E] transition hover:bg-[#EEF4EF]"
          >
            Ya tengo una cuenta
          </Link>

          <div className="mt-8 flex items-start justify-center gap-2 text-center text-xs leading-relaxed text-[#7A6E66]">
            <LockIcon />

            <p>
              Tus credenciales son tratadas de
              forma segura y tu contraseña no se
              almacena en texto plano.
            </p>
          </div>
        </div>
      </section>
    </main>
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
      <circle
        cx="12"
        cy="12"
        r="3"
      />
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
      className="mt-0.5 shrink-0"
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