'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiErrorNotice } from '../../components/api-error-notice';
import { BackLink, PageIntro } from '../../components/app-shell';
import { getMyProfile, updateEmailReminders, type PatientProfile } from '../../lib/api';
import { formatBirthDate, genderLabel } from '../../lib/profile';
import { portalError, withSession } from '../../lib/psychologist';

export default function ProfilePage() {
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    withSession((token) => getMyProfile(token))
      .then((result) => { if (active) setProfile(result); })
      .catch((caught: unknown) => {
        if (active) setError(portalError(caught, 'No fue posible cargar tu perfil. Revisa tu conexión y reintenta.'));
      });
    return () => { active = false; };
  }, [revision]);

  return (
    <>
      <BackLink href="/dashboard">Volver al inicio</BackLink>
      <PageIntro
        kicker="Tu cuenta"
        title="Mi perfil"
        description="Estos datos nos ayudan a contactarte y a preparar tus sesiones."
        actions={profile && <Link href="/profile/edit" className="btn btn-primary">Editar perfil</Link>}
      />

      {error ? (
        <ApiErrorNotice error={error} onRetry={() => { setError(null); setRevision((value) => value + 1); }} messages={{ 404: 'No se encontró tu perfil de paciente.' }} />
      ) : !profile ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando perfil...</p>
      ) : (
        <div className="space-y-6">
          {!profile.isProfileComplete && (
            <section className="rounded-2xl border border-[#E2CFAE] bg-[#FFF8EA] p-5 sm:p-6">
              <h2 className="font-semibold text-[#6A5435]">Tu perfil está incompleto</h2>
              <p className="mt-1 text-sm leading-relaxed text-[#806A4A]">Completa nombre, fecha de nacimiento, género y teléfono para agendar con normalidad.</p>
              <Link href="/profile/edit" className="btn btn-primary mt-4">Completar perfil</Link>
            </section>
          )}

          <section className="surface overflow-hidden">
            <div className="flex items-center gap-4 border-b border-border bg-mint p-5 sm:p-6">
              <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-forest font-serif text-2xl text-white">
                {(profile.fullName?.trim()[0] ?? '?').toUpperCase()}
              </span>
              <div className="min-w-0">
                <p className="break-words font-serif text-xl text-foreground">{profile.fullName?.trim() || 'Nombre sin registrar'}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">Número de paciente <span className="whitespace-nowrap font-medium tabular-nums text-foreground">{profile.mrn}</span></p>
              </div>
            </div>
            <dl className="grid gap-px bg-border sm:grid-cols-2">
              <ProfileItem label="Fecha de nacimiento" value={formatBirthDate(profile.birthDate)} />
              <ProfileItem label="Género" value={genderLabel(profile.gender, profile.genderOther)} />
              <ProfileItem label="Teléfono" value={profile.phone} />
              <ProfileItem label="Estado del perfil" value={profile.isProfileComplete ? 'Completo' : 'Incompleto'} />
            </dl>
          </section>

          <EmailRemindersCard
            enabled={profile.emailRemindersEnabled}
            onChange={(value) => setProfile((current) => current && { ...current, emailRemindersEnabled: value })}
          />

          <div className="flex flex-col gap-3 sm:flex-row">
            <Link href="/dashboard" className="btn btn-secondary">Volver al inicio</Link>
            <Link href="/appointments" className="btn btn-quiet">Ver mis citas</Link>
          </div>
        </div>
      )}
    </>
  );
}

function ProfileItem({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="bg-card p-5">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={`mt-1 break-words font-medium ${value ? 'text-foreground' : 'italic text-muted-foreground'}`}>{value || 'Sin registrar'}</dd>
    </div>
  );
}

// Explicit opt-in: off by default, changed only by the patient's own click.
function EmailRemindersCard({ enabled, onChange }: { enabled: boolean; onChange: (value: boolean) => void }) {
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [failed, setFailed] = useState(false);

  async function toggle() {
    setSaving(true);
    setMessage('');
    setFailed(false);
    try {
      const result = await withSession((token) => updateEmailReminders(token, !enabled));
      onChange(result.emailReminders);
      setMessage(result.emailReminders ? 'Recordatorios activados.' : 'Recordatorios desactivados.');
    } catch {
      setFailed(true);
      setMessage('No fue posible guardar tu preferencia. Intenta de nuevo.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section aria-labelledby="email-reminders" className="surface p-5 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-xl">
          <h2 id="email-reminders" className="font-serif text-xl text-foreground">Recordatorios por correo</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-soft">
            Si los activas, te enviaremos un correo 24 horas antes de cada cita con la fecha y la hora, sin detalles de tu atención.
            La confirmación, los cambios y las cancelaciones de tus citas siempre se envían a tu correo.
          </p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-labelledby="email-reminders"
          onClick={() => void toggle()}
          disabled={saving}
          className={`btn min-w-36 ${enabled ? 'btn-primary' : 'btn-secondary'}`}
        >
          {saving ? 'Guardando...' : enabled ? 'Activados' : 'Desactivados'}
        </button>
      </div>
      {message && (
        <p role="status" className={`mt-3 text-sm ${failed ? 'text-red-800' : 'text-forest'}`}>{message}</p>
      )}
    </section>
  );
}
