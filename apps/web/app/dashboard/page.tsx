'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { AppHeader } from '../../components/app-header';
import { getMyProfile } from '../../lib/api';

interface PatientProfile {
  id: string;
  mrn: string;
  fullName: string | null;
  birthDate: string | null;
  gender: string | null;
  genderOther: string | null;
  phone: string | null;
  isProfileComplete: boolean;
}

export default function DashboardPage() {
  const router = useRouter();

  const [profile, setProfile] =
    useState<PatientProfile | null>(null);

  const [isLoading, setIsLoading] =
    useState(true);

  const [error, setError] = useState('');

  useEffect(() => {
    async function loadDashboard() {
      const token =
        sessionStorage.getItem('accessToken');

      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const result =
          await getMyProfile(token);

        setProfile(result);
      } catch (error) {
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError(
            'No fue posible cargar la información.',
          );
        }
      } finally {
        setIsLoading(false);
      }
    }

    void loadDashboard();
  }, [router]);

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F5F0EB]">
        <p className="text-sm text-[#7A6E66]">
          Cargando...
        </p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#F5F0EB] px-4">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
        </div>
      </main>
    );
  }

  if (!profile) {
    return null;
  }

  const firstName =
    profile.fullName?.trim().split(' ')[0] ??
    'paciente';

  return (
    <div className="min-h-screen bg-[#F5F0EB]">
      <AppHeader />

      <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Bienvenida */}
        <section className="mb-8">
          <p className="text-sm font-medium text-[#6B8F71]">
            Mental Pieces
          </p>

          <h1 className="mt-1 font-serif text-3xl font-medium text-[#2C2420] sm:text-4xl">
            Hola, {firstName}
          </h1>

          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[#7A6E66] sm:text-base">
            Desde aquí podrás gestionar tu
            información y, progresivamente, tus
            citas y procesos asociados.
          </p>
        </section>

        {/* Perfil incompleto */}
        {!profile.isProfileComplete && (
          <section className="mb-6 rounded-2xl border border-[#E2CFAE] bg-[#FFF8EA] p-5 sm:p-6">
            <p className="font-semibold text-[#6A5435]">
              Completa tu perfil
            </p>

            <p className="mt-1 text-sm leading-relaxed text-[#806A4A]">
              Necesitamos algunos datos básicos
              antes de habilitar determinadas
              funciones de la plataforma.
            </p>

            <button
              type="button"
              onClick={() =>
                router.push('/profile/edit')
              }
              className="mt-4 rounded-xl bg-[#6B8F71] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#587A5E]"
            >
              Completar perfil
            </button>
          </section>
        )}

        {/* Próxima cita */}
        <section className="rounded-2xl border border-[#DED6CD] bg-white p-5 shadow-sm sm:p-7">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-[#6B8F71]">
                Próxima cita
              </p>

              <h2 className="mt-1 text-xl font-semibold text-[#2C2420]">
                No tienes citas programadas
              </h2>

              <p className="mt-2 text-sm text-[#7A6E66]">
                La gestión de citas estará
                disponible cuando terminemos el
                módulo de disponibilidad y
                agendamiento.
              </p>
            </div>

            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-[#EEF4EF] text-[#6B8F71]">
              <CalendarIcon />
            </div>
          </div>
        </section>

        {/* Acciones */}
        <section className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <DashboardCard
            title="Agendar cita"
            description="Consulta horarios disponibles y solicita una cita."
            disabled
            icon={<CalendarIcon />}
          />

          <DashboardCard
            title="Mis citas"
            description="Consulta tus citas programadas y su estado."
            disabled
            icon={<AppointmentsIcon />}
          />

          <DashboardCard
            title="Mi perfil"
            description="Consulta y actualiza tu información personal."
            onClick={() =>
              router.push('/profile')
            }
            icon={<UserIcon />}
          />
        </section>

        {/* Información básica */}
        <section className="mt-8">
          <h2 className="font-serif text-2xl font-medium text-[#2C2420]">
            Tu información
          </h2>

          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <InfoCard
              label="Número de paciente"
              value={profile.mrn}
            />

            <InfoCard
              label="Estado del perfil"
              value={
                profile.isProfileComplete
                  ? 'Completo'
                  : 'Incompleto'
              }
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function DashboardCard({
  title,
  description,
  icon,
  disabled = false,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="group rounded-2xl border border-[#DED6CD] bg-white p-5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0 disabled:hover:shadow-sm"
    >
      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#EEF4EF] text-[#6B8F71]">
        {icon}
      </div>

      <h3 className="mt-4 font-semibold text-[#2C2420]">
        {title}
      </h3>

      <p className="mt-1 text-sm leading-relaxed text-[#7A6E66]">
        {description}
      </p>

      {disabled && (
        <span className="mt-4 inline-block rounded-full bg-[#F1ECE6] px-3 py-1 text-xs font-medium text-[#81756D]">
          Próximamente
        </span>
      )}
    </button>
  );
}

function InfoCard({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-xl border border-[#DED6CD] bg-white p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-[#8A7E75]">
        {label}
      </p>

      <p className="mt-1 break-all font-medium text-[#2C2420]">
        {value}
      </p>
    </div>
  );
}

function CalendarIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect
        x="3"
        y="5"
        width="18"
        height="16"
        rx="2"
      />
      <path d="M16 3v4M8 3v4M3 11h18" />
    </svg>
  );
}

function AppointmentsIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M9 11l3 3L22 4" />
      <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M20 21a8 8 0 00-16 0" />
      <circle
        cx="12"
        cy="7"
        r="4"
      />
    </svg>
  );
}