import type { ReactNode } from 'react';
import { AppHeader } from '../../components/app-header';
import { RoleGate } from '../../components/role-gate';

export default function PsychologistLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="PSYCHOLOGIST">
      <div className="min-h-screen bg-background">
        <AppHeader role="PSYCHOLOGIST" />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </RoleGate>
  );
}
