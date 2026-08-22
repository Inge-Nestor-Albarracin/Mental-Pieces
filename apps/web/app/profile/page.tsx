'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

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

export default function ProfilePage() {
  const router = useRouter();

  const [profile, setProfile] =
    useState<PatientProfile | null>(null);

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadProfile() {
      const token =
        sessionStorage.getItem('accessToken');

      if (!token) {
        router.push('/login');
        return;
      }

      try {
        const result = await getMyProfile(token);

        setProfile(result);
      } catch (error) {
        if (error instanceof Error) {
          setError(error.message);
        } else {
          setError(
            'No fue posible cargar el perfil.',
          );
        }
      } finally {
        setIsLoading(false);
      }
    }

    void loadProfile();
  }, [router]);

  function logout() {
    sessionStorage.removeItem('accessToken');
    router.push('/login');
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Cargando perfil...</p>
      </main>
    );
  }

  if (error) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p className="text-red-600">
          {error}
        </p>
      </main>
    );
  }

  if (!profile) {
    return null;
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <section className="mx-auto max-w-3xl rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-8 flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-500">
              Mental Pieces
            </p>

            <h1 className="text-3xl font-semibold text-slate-900">
              Mi perfil
            </h1>
          </div>

          <div className="flex gap-3">
  <button
    type="button"
    onClick={() => router.push('/profile/edit')}
    className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700"
  >
    Editar perfil
  </button>

  <button
    type="button"
    onClick={logout}
    className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
  >
    Cerrar sesión
  </button>
</div>
        </div>

        <div className="grid gap-5 sm:grid-cols-2">
          <ProfileItem
            label="Nombre"
            value={profile.fullName}
          />

          <ProfileItem
            label="Número de paciente"
            value={profile.mrn}
          />

          <ProfileItem
            label="Fecha de nacimiento"
            value={
              profile.birthDate
                ? new Date(
                    profile.birthDate,
                  ).toLocaleDateString()
                : null
            }
          />

          <ProfileItem
            label="Género"
            value={profile.gender}
          />

          <ProfileItem
            label="Teléfono"
            value={profile.phone}
          />

          <ProfileItem
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
  );
}

function ProfileItem({
  label,
  value,
}: {
  label: string;
  value: string | null;
}) {
  return (
    <div className="rounded-xl border border-slate-200 p-4">
      <p className="text-sm text-slate-500">
        {label}
      </p>

      <p className="mt-1 font-medium text-slate-900">
        {value || 'Sin registrar'}
      </p>
    </div>
  );
}