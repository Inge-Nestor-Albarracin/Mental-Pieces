'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { ApiError } from '../lib/api';

export function ApiErrorNotice({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  const status = error instanceof ApiError ? error.status : undefined;

  useEffect(() => {
    if (status === 401) sessionStorage.removeItem('accessToken');
  }, [status]);

  const message = status === 401
    ? 'Tu sesión no es válida o ha vencido. Inicia sesión de nuevo.'
    : status === 403
      ? 'No tienes permiso para acceder a esta sección.'
      : status === 409
        ? 'Este horario se superpone con otro bloque de disponibilidad. Revisa el día y las horas.'
        : status === 404
          ? 'El horario ya no está disponible. Actualiza la lista antes de continuar.'
          : error.message;

  return (
    <div role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
      <p>{message}</p>
      {status === 401 ? (
        <Link href="/login" className="mt-2 inline-flex min-h-11 items-center font-semibold underline">Ir a iniciar sesión</Link>
      ) : onRetry && status !== 403 ? (
        <button type="button" onClick={onRetry} className="mt-2 min-h-11 font-semibold underline">Reintentar</button>
      ) : null}
    </div>
  );
}
