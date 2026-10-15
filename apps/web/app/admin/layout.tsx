import type { ReactNode } from 'react';
import { AppShell } from '../../components/app-shell';
import { RoleGate } from '../../components/role-gate';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="ADMIN">
      <AppShell role="ADMIN">{children}</AppShell>
    </RoleGate>
  );
}
