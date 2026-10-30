import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';
import { RoleGate } from '../../components/role-gate';

export default function DataConsentLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="PATIENT">
      <AppShell role="PATIENT" width="narrow">{children}</AppShell>
    </RoleGate>
  );
}
