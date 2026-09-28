'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { ApiError, getCurrentUser, type UserRole } from '../lib/api';
import { ApiErrorNotice } from './api-error-notice';

// Navigation/UX only. Each backend endpoint still enforces role and ownership.
export function RoleGate({ role, children }: { role: UserRole; children: ReactNode }) {
  const router = useRouter();
  const [allowed, setAllowed] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function checkRole() {
      const token = sessionStorage.getItem('accessToken');
      try {
        if (!token) throw new ApiError(401, 'Sesión requerida.');
        const user = await getCurrentUser(token);
        if (!active) return;
        if (user.role === role) {
          setAllowed(true);
        } else if (user.role === 'PATIENT' || user.role === 'PSYCHOLOGIST') {
          router.replace(user.role === 'PATIENT' ? '/dashboard' : '/psychologist/dashboard');
        } else {
          setError(new ApiError(403, 'Sin acceso a este portal.'));
        }
      } catch (caught) {
        if (active) setError(caught instanceof ApiError ? caught : new Error('No fue posible verificar tu sesión. Revisa tu conexión.'));
      }
    }
    void checkRole();
    return () => { active = false; };
  }, [role, router, attempt]);

  if (allowed) return children;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        {error ? (
          <>
            <ApiErrorNotice error={error} onRetry={() => { setError(null); setAttempt((value) => value + 1); }} />
            {error instanceof ApiError && error.status === 403 && (
              <button type="button" className="mt-4 min-h-11 rounded-xl border border-border px-4" onClick={() => {
                sessionStorage.removeItem('accessToken');
                router.replace('/login');
              }}>Salir</button>
            )}
          </>
        ) : <p role="status" className="text-center text-sm text-muted-foreground">Verificando acceso...</p>}
      </div>
    </main>
  );
}
