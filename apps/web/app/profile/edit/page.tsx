'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { ApiErrorNotice } from '../../../components/api-error-notice';
import { BackLink, PageIntro } from '../../../components/app-shell';
import { ApiError, getMyProfile, updateMyProfile, type Gender } from '../../../lib/api';
import { businessNow } from '../../../lib/appointments';
import { GENDER_OPTIONS, birthDateInput } from '../../../lib/profile';
import { portalError, requireSessionToken, withSession } from '../../../lib/psychologist';

export default function EditProfilePage() {
  const router = useRouter();
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [fullName, setFullName] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [gender, setGender] = useState<Gender | ''>('');
  const [genderOther, setGenderOther] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');
  const [today] = useState(() => businessNow().date);

  useEffect(() => {
    let active = true;
    withSession((token) => getMyProfile(token))
      .then((profile) => {
        if (!active) return;
        setFullName(profile.fullName ?? '');
        setBirthDate(birthDateInput(profile.birthDate));
        setGender(profile.gender ?? '');
        setGenderOther(profile.genderOther ?? '');
        setPhone(profile.phone ?? '');
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(portalError(caught, 'No fue posible cargar tu perfil. Revisa tu conexión y reintenta.'));
      });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    if (!gender) {
      setFormError('Selecciona una opción de género.');
      return;
    }
    setSaving(true);
    try {
      await updateMyProfile(requireSessionToken(), {
        fullName: fullName.trim(),
        birthDate,
        gender,
        genderOther: gender === 'OTHER' ? genderOther.trim() : undefined,
        phone: phone.trim(),
      });
      router.push('/profile');
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) setLoadError(caught);
      else setFormError(caught instanceof ApiError && caught.status < 500 ? caught.message : 'No fue posible guardar los cambios. Intenta de nuevo.');
      setSaving(false);
    }
  }

  return (
    <>
      <BackLink href="/profile">Volver a mi perfil</BackLink>
      <PageIntro kicker="Tu cuenta" title="Editar perfil" description="Todos los campos son obligatorios para completar tu perfil." />

      {loadError ? (
        <ApiErrorNotice error={loadError} messages={{ 404: 'No se encontró tu perfil de paciente.' }} />
      ) : !loaded ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando perfil...</p>
      ) : (
        <form onSubmit={submit} className="surface space-y-5 p-5 sm:p-8">
          <fieldset disabled={saving} className="grid gap-5 sm:grid-cols-2">
            <legend className="sr-only">Datos personales</legend>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label htmlFor="fullName" className="field-label">Nombre completo</label>
              <input id="fullName" type="text" required minLength={2} maxLength={120} autoComplete="name"
                value={fullName} onChange={(event) => setFullName(event.target.value)} className="field" />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="birthDate" className="field-label">Fecha de nacimiento</label>
              <input id="birthDate" type="date" required max={today} autoComplete="bday"
                value={birthDate} onChange={(event) => setBirthDate(event.target.value)} className="field" />
            </div>
            <div className="flex flex-col gap-2">
              <label htmlFor="phone" className="field-label">Teléfono</label>
              <input id="phone" type="tel" required minLength={7} maxLength={25} inputMode="tel" autoComplete="tel"
                placeholder="300 123 4567" value={phone} onChange={(event) => setPhone(event.target.value)} className="field" />
            </div>
            <div className="flex flex-col gap-2 sm:col-span-2">
              <label htmlFor="gender" className="field-label">Género</label>
              <select id="gender" required value={gender} onChange={(event) => setGender(event.target.value as Gender)} className="field">
                <option value="">Seleccionar</option>
                {GENDER_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </div>
            {gender === 'OTHER' && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <label htmlFor="genderOther" className="field-label">¿Cómo te identificas?</label>
                <input id="genderOther" type="text" required maxLength={80}
                  value={genderOther} onChange={(event) => setGenderOther(event.target.value)} className="field" />
              </div>
            )}
          </fieldset>

          {formError && <p role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <Link href="/profile" className="btn btn-quiet">Cancelar</Link>
            <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Guardando...' : 'Guardar cambios'}</button>
          </div>
        </form>
      )}
    </>
  );
}
