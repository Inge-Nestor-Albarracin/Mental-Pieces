'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { ApiErrorNotice } from '../../../components/api-error-notice';
import { BackLink, PageIntro } from '../../../components/app-shell';
import { ApiError, getMyProfile, updateMyProfile, type Gender } from '../../../lib/api';
import { businessNow } from '../../../lib/appointments';
import { DATA_POLICY_PATH, PATIENT_HOME } from '../../../lib/onboarding';
import { GENDER_OPTIONS, birthDateInput, profileFormIssue, isUnderage } from '../../../lib/profile';
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
  // First-time completion (from the login redirect or an incomplete profile).
  const [onboarding, setOnboarding] = useState(false);
  const [completed, setCompleted] = useState(false);

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
        setOnboarding(new URLSearchParams(window.location.search).get('onboarding') === '1' || !profile.isProfileComplete);
        setLoaded(true);
      })
      .catch((caught: unknown) => {
        if (active) setLoadError(portalError(caught, 'No fue posible cargar tu perfil. Revisa tu conexión y reintenta.'));
      });
    return () => { active = false; };
  }, []);

  // After the confirmation, onboarding continues to the patient home by itself.
  useEffect(() => {
    if (!completed) return;
    const timer = setTimeout(() => router.replace(PATIENT_HOME), 2500);
    return () => clearTimeout(timer);
  }, [completed, router]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    const issue = profileFormIssue({ fullName, birthDate, gender, genderOther, phone }, today);
    if (issue || !gender) {
      setFormError(issue ?? 'Selecciona una opción de género.');
      return;
    }
    setSaving(true);
    try {
      const saved = await updateMyProfile(requireSessionToken(), {
        fullName: fullName.trim(),
        birthDate,
        gender,
        genderOther: gender === 'OTHER' ? genderOther.trim() : undefined,
        phone: phone.trim(),
      });
      if (onboarding) {
        // Only the server decides that the profile is complete.
        if (!saved.isProfileComplete) {
          setFormError('Aún faltan datos válidos en tu perfil. Revisa los campos e intenta de nuevo.');
          setSaving(false);
          return;
        }
        setCompleted(true);
        return;
      }
      router.push('/profile');
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) setLoadError(caught);
      else setFormError(caught instanceof ApiError && caught.status < 500 ? caught.message : 'No fue posible guardar los cambios. Intenta de nuevo.');
      setSaving(false);
    }
  }

  if (completed) {
    return (
      <section role="status" className="surface space-y-4 p-6 sm:p-8">
        <h1 className="text-2xl font-bold text-foreground">¡Tu perfil está completo!</h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Ya puedes consultar la disponibilidad de los profesionales y agendar tu primera cita.
        </p>
        <Link href={PATIENT_HOME} replace className="btn btn-primary">Ir al inicio</Link>
      </section>
    );
  }

  return (
    <>
      {onboarding ? (
        <>
          <PageIntro
            kicker="Bienvenida"
            title="Completa tu perfil"
            description="Antes de agendar tu primera cita, necesitamos que completes tus datos personales. Esta información nos permite identificarte y gestionar tus citas correctamente."
          />
          <p className="mb-5 text-sm leading-relaxed text-muted-foreground">
            Solo pedimos lo necesario para tu cuenta y tus citas. Estos datos son confidenciales y se tratan según la{' '}
            <a href={DATA_POLICY_PATH} target="_blank" rel="noopener noreferrer" className="font-bold text-forest underline underline-offset-2">
              Política de Tratamiento de Datos Personales
            </a>
            . En «Género» puedes elegir «Prefiero no especificarlo».
          </p>
        </>
      ) : (
        <>
          <BackLink href="/profile">Volver a mi perfil</BackLink>
          <PageIntro kicker="Tu cuenta" title="Editar perfil" description="Todos los campos son obligatorios para completar tu perfil." />
        </>
      )}

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

          {isUnderage(birthDate, today) && (
            <p className="rounded-[10px] border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Por ahora la reserva de citas en línea es solo para mayores de 18 años. Puedes guardar tu perfil; para agendar,
              comunícate con el consultorio.
            </p>
          )}

          {formError && <p role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            {!onboarding && <Link href="/profile" className="btn btn-quiet">Cancelar</Link>}
            <button type="submit" disabled={saving} className="btn btn-primary">
              {saving ? 'Guardando...' : onboarding ? 'Guardar y continuar' : 'Guardar cambios'}
            </button>
          </div>
        </form>
      )}
    </>
  );
}
