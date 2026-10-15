import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';
import { RoleGate } from '../../components/role-gate';

export default function PsychologistLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="PSYCHOLOGIST">
      <AppShell role="PSYCHOLOGIST">{children}</AppShell>
    </RoleGate>
  );
}
