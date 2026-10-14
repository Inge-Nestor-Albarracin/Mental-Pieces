import type { ReactNode } from 'react';
import { AppHeader } from '../../components/app-header';
import { RoleGate } from '../../components/role-gate';

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <RoleGate role="ADMIN">
      <div className="min-h-screen bg-background">
        <AppHeader role="ADMIN" />
        <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-10">{children}</main>
      </div>
    </RoleGate>
  );
}
