'use client';

import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useRouter } from 'next/navigation';

import {
  getMyProfile,
  updateMyProfile,
} from '../../../lib/api';

type Gender =
  | 'MALE'
  | 'FEMALE'
  | 'NON_BINARY'
  | 'PREFER_NOT_TO_SAY'
  | 'OTHER';

export default function EditProfilePage() {
  const router = useRouter();

  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [genderOther, setGenderOther] =
    useState('');
  const [phone, setPhone] = useState('');

  const [error, setError] = useState('');
  const [isLoading, setIsLoading] =
    useState(true);
  const [isSaving, setIsSaving] =
    useState(false);

  useEffect(() => {
    async function loadProfile() {
      const token =
        sessionStorage.getItem('accessToken');

      if (!token) {
        router.replace('/login');
        return;
      }

      try {
        const profile =
          await getMyProfile(token);

        setFullName(profile.fullName ?? '');

        setBirthDate(
          profile.birthDate
            ? profile.birthDate.slice(0, 10)
            : '',
        );

        setGender(profile.gender ?? '');
        setGenderOther(
          profile.genderOther ?? '',
        );
        setPhone(profile.phone ?? '');
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

  async function handleSubmit(
    event: FormEvent<HTMLFormElement>,
  ) {
    event.preventDefault();

    const token =
      sessionStorage.getItem('accessToken');

    if (!token) {
      router.replace('/login');
      return;
    }

    setError('');
    setIsSaving(true);

    try {
      await updateMyProfile(token, {
        fullName,
        birthDate,
        gender: gender || undefined,

        genderOther:
          gender === 'OTHER'
            ? genderOther
            : undefined,

        phone,
      });

      router.push('/profile');
    } catch (error) {
      if (error instanceof Error) {
        setError(error.message);
      } else {
        setError(
          'No fue posible actualizar el perfil.',
        );
      }
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <p>Cargando perfil...</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 px-4 py-10">
      <section className="mx-auto max-w-xl rounded-2xl bg-white p-8 shadow-lg">
        <div className="mb-8">
          <p className="text-sm text-slate-500">
            Mental Pieces
          </p>

          <h1 className="text-3xl font-semibold text-slate-900">
            Editar perfil
          </h1>
        </div>

        <form
          onSubmit={handleSubmit}
          className="space-y-5"
        >
          <div>
            <label
              htmlFor="fullName"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Nombre completo
            </label>

            <input
              id="fullName"
              type="text"
              required
              value={fullName}
              onChange={(event) =>
                setFullName(event.target.value)
              }
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="birthDate"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Fecha de nacimiento
            </label>

            <input
              id="birthDate"
              type="date"
              required
              value={birthDate}
              onChange={(event) =>
                setBirthDate(event.target.value)
              }
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
            />
          </div>

          <div>
            <label
              htmlFor="gender"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Género
            </label>

            <select
              id="gender"
              required
              value={gender}
              onChange={(event) =>
                setGender(
                  event.target.value as Gender,
                )
              }
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
            >
              <option value="">
                Seleccionar
              </option>

              <option value="MALE">
                Masculino
              </option>

              <option value="FEMALE">
                Femenino
              </option>

              <option value="NON_BINARY">
                No binario
              </option>

              <option value="PREFER_NOT_TO_SAY">
                Prefiero no especificarlo
              </option>

              <option value="OTHER">
                Otro
              </option>
            </select>
          </div>

          {gender === 'OTHER' && (
            <div>
              <label
                htmlFor="genderOther"
                className="mb-2 block text-sm font-medium text-slate-700"
              >
                Especificar
              </label>

              <input
                id="genderOther"
                type="text"
                required
                value={genderOther}
                onChange={(event) =>
                  setGenderOther(
                    event.target.value,
                  )
                }
                className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
              />
            </div>
          )}

          <div>
            <label
              htmlFor="phone"
              className="mb-2 block text-sm font-medium text-slate-700"
            >
              Teléfono
            </label>

            <input
              id="phone"
              type="tel"
              required
              value={phone}
              onChange={(event) =>
                setPhone(event.target.value)
              }
              className="w-full rounded-lg border border-slate-300 px-4 py-3 text-slate-900"
            />
          </div>

          {error && (
            <p className="rounded-lg bg-red-50 p-3 text-sm text-red-700">
              {error}
            </p>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={() =>
                router.push('/profile')
              }
              className="flex-1 rounded-lg border border-slate-300 px-4 py-3 font-medium text-slate-700"
            >
              Cancelar
            </button>

            <button
              type="submit"
              disabled={isSaving}
              className="flex-1 rounded-lg bg-slate-900 px-4 py-3 font-medium text-white disabled:opacity-60"
            >
              {isSaving
                ? 'Guardando...'
                : 'Guardar cambios'}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}