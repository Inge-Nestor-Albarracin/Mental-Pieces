import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';
import { RoleGate } from '../../components/role-gate';

export default function StaffLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="STAFF">
      <AppShell role="STAFF">{children}</AppShell>
    </RoleGate>
  );
}
