'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';

import { ApiErrorNotice } from '../../components/api-error-notice';
import { PageIntro } from '../../components/app-shell';
import { ApiError, acceptDataPolicy, getDataPolicy, getMyProfile, type DataPolicy } from '../../lib/api';
import { DATA_POLICY_PATH, patientLanding } from '../../lib/onboarding';
import { portalError, requireSessionToken, withSession } from '../../lib/psychologist';

const ACCEPTANCE_REQUIRED = 'Para continuar debes leer y aceptar la Política de Tratamiento de Datos Personales.';

// Accounts created before the policy (or before a version that requires a new
// authorisation) accept it here, explicitly. Nothing is assumed on their behalf.
export default function DataConsentPage() {
  const router = useRouter();
  const [policy, setPolicy] = useState<DataPolicy | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [accepted, setAccepted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState('');

  useEffect(() => {
    let active = true;
    getDataPolicy()
      .then((loaded) => { if (active) setPolicy(loaded); })
      .catch((caught: unknown) => {
        if (active) setLoadError(portalError(caught, 'No fue posible cargar la política. Revisa tu conexión y reintenta.'));
      });
    return () => { active = false; };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError('');
    if (!accepted) {
      setFormError(ACCEPTANCE_REQUIRED);
      return;
    }
    if (!policy) return;
    setSaving(true);
    try {
      const token = requireSessionToken();
      await acceptDataPolicy(token, policy.version);
      const profile = await withSession((session) => getMyProfile(session));
      router.replace(patientLanding(profile));
    } catch (caught) {
      if (caught instanceof ApiError && (caught.status === 401 || caught.status === 403)) setLoadError(caught);
      else setFormError(caught instanceof ApiError && caught.status < 500 ? caught.message : 'No fue posible registrar tu autorización. Intenta de nuevo.');
      setSaving(false);
    }
  }

  return (
    <>
      <PageIntro
        kicker="Antes de continuar"
        title="Autorización de tratamiento de datos personales"
        description="Para seguir usando tu cuenta necesitamos que conozcas y autorices la Política de Tratamiento de Datos Personales vigente. No hemos registrado ninguna autorización a tu nombre sin que la des."
      />

      {loadError ? (
        <ApiErrorNotice error={loadError} />
      ) : policy === undefined ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando la política...</p>
      ) : policy === null ? (
        <p role="status" className="surface p-6 text-sm text-muted-foreground">
          La política aún no está publicada, por lo que por ahora no es posible autorizarla. Vuelve a intentarlo más tarde.
        </p>
      ) : (
        <form onSubmit={submit} className="surface space-y-5 p-5 sm:p-8">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Versión vigente: <strong className="text-foreground">{policy.version}</strong>.{' '}
            <a href={DATA_POLICY_PATH} target="_blank" rel="noopener noreferrer" className="font-bold text-forest underline underline-offset-2">
              Leer la Política de Tratamiento de Datos Personales
            </a>{' '}
            (se abre en una pestaña nueva).
          </p>

          <div className="flex items-start gap-3">
            <input id="acceptDataPolicy" type="checkbox" checked={accepted} disabled={saving}
              onChange={(event) => setAccepted(event.target.checked)}
              aria-invalid={formError === ACCEPTANCE_REQUIRED} className="mt-0.5 h-5 w-5 shrink-0 accent-forest" />
            <label htmlFor="acceptDataPolicy" className="text-sm leading-relaxed">
              He leído la Política de Tratamiento de Datos Personales de Mental Pieces y autorizo de manera previa, expresa e
              informada a MENTAL PIECES BY PAULA SARMIENTO S A S para recolectar, almacenar y utilizar mis datos personales con la
              finalidad de crear y administrar mi cuenta, gestionar mi perfil y permitir el acceso a las funcionalidades
              solicitadas, conforme a las condiciones informadas en dicha política.
            </label>
          </div>

          {formError && <p role="alert" className="rounded-[10px] border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{formError}</p>}

          <div className="flex justify-end">
            <button type="submit" disabled={saving} className="btn btn-primary">{saving ? 'Guardando...' : 'Aceptar y continuar'}</button>
          </div>
        </form>
      )}
    </>
  );
}
