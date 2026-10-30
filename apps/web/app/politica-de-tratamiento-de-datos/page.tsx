'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { getDataPolicy, type DataPolicy } from '../../lib/api';

// Public page: the exact published text (version and fingerprint included) that
// people accept when they create an account. Nothing here is hard-coded: if no
// reviewed version has been published yet, the page says so.
export default function DataPolicyPage() {
  const [policy, setPolicy] = useState<DataPolicy | null | undefined>(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    getDataPolicy()
      .then((loaded) => { if (active) setPolicy(loaded); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);

  return (
    <main className="min-h-dvh bg-[#FAF7F4] px-5 py-10 sm:px-8">
      <article className="mx-auto w-full max-w-3xl rounded-2xl border border-[#E4DCD3] bg-white p-6 shadow-sm sm:p-10">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#6B8F71]">Mental Pieces</p>

        {failed ? (
          <p role="alert" className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            No fue posible cargar la política. Revisa tu conexión y recarga la página.
          </p>
        ) : policy === undefined ? (
          <p role="status" className="mt-4 text-sm text-[#7A6E66]">Cargando la política...</p>
        ) : policy === null ? (
          <>
            <h1 className="mt-2 font-serif text-2xl font-medium text-[#2C2420] sm:text-3xl">
              Política de Tratamiento de Datos Personales
            </h1>
            <p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              La política aún no está publicada. Mientras tanto no es posible crear cuentas ni autorizar el tratamiento de datos.
            </p>
          </>
        ) : (
          <>
            <h1 className="mt-2 font-serif text-2xl font-medium text-[#2C2420] sm:text-3xl">{policy.title}</h1>
            <p className="mt-2 text-xs text-[#8A7E75]">
              Versión {policy.version} · publicada el{' '}
              {new Intl.DateTimeFormat('es-CO', { dateStyle: 'long', timeZone: 'America/Bogota' }).format(new Date(policy.publishedAt))}
            </p>
            <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-[#3D332E]">{policy.body}</div>
            <p className="mt-8 break-all text-[11px] text-[#A79D95]">Huella del texto (SHA-256): {policy.sha256}</p>
          </>
        )}

        <div className="mt-8 flex flex-wrap gap-3 text-sm">
          <Link href="/register" className="font-semibold text-[#587A5E] underline underline-offset-2">Crear una cuenta</Link>
          <Link href="/login" className="font-semibold text-[#587A5E] underline underline-offset-2">Iniciar sesión</Link>
        </div>
      </article>
    </main>
  );
}
