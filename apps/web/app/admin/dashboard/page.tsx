'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Hero, Icon, QuickCard, SectionHeading, StatusPill } from '../../../components/ui';
import { getAdminCareAlerts, getCareAssignments } from '../../../lib/api';
import { withSession } from '../../../lib/psychologist';

interface Overview {
  active: number | null;
  ended: number | null;
  moreAssignments: boolean;
  alerts: number | null;
}

// Administrative overview only: counts of relationships and alerts, never clinical content.
export default function AdminDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);

  useEffect(() => {
    let active = true;
    Promise.allSettled([
      withSession((token) => getCareAssignments(token, 1)),
      withSession((token) => getAdminCareAlerts(token, 1)),
    ]).then(([assignments, alerts]) => {
      if (!active) return;
      const items = assignments.status === 'fulfilled' ? assignments.value.items : null;
      setOverview({
        active: items ? items.filter((item) => item.isActive).length : null,
        ended: items ? items.filter((item) => !item.isActive).length : null,
        moreAssignments: assignments.status === 'fulfilled' && assignments.value.hasMore,
        alerts: alerts.status === 'fulfilled' ? alerts.value.total : null,
      });
    });
    return () => { active = false; };
  }, []);

  const suffix = overview?.moreAssignments ? '+' : '';

  return (
    <>
      <Hero
        eyebrow="Administración"
        title="Panel administrativo"
        description="Crea las cuentas de psicólogos y staff, gestiona qué psicólogo atiende a cada paciente y vigila el seguimiento operativo. Administrar no da acceso al contenido clínico."
        actions={<>
          <Link href="/admin/clinical-assignments" className="btn btn-on-dark">Gestionar asignaciones <Icon name="arrow" size={18} /></Link>
          <Link href="/admin/users" className="btn btn-ghost-on-dark"><Icon name="userPlus" size={18} />Crear usuario</Link>
        </>}
        note={{ title: 'Sin acceso a notas', text: 'Separación administrativa y clínica', icon: 'shield' }}
      />

      <section className="mt-6 grid gap-4 sm:grid-cols-3" aria-label="Resumen">
        <Metric icon="link" label="Relaciones activas" value={overview?.active ?? null} suffix={suffix} tone="green" href="/admin/clinical-assignments" />
        <Metric icon="clock" label="Relaciones finalizadas" value={overview?.ended ?? null} suffix={suffix} tone="gray" href="/admin/clinical-assignments" />
        <Metric icon="bell" label="Alertas de seguimiento" value={overview?.alerts ?? null} tone={overview?.alerts ? 'amber' : 'green'} href="/admin/alerts" />
      </section>

      <section className="mt-12" aria-labelledby="quick-title">
        <SectionHeading eyebrow="Todo en un solo lugar" title="Accesos rápidos" id="quick-title" />
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <QuickCard href="/admin/users" icon="userPlus" title="Usuarios internos" description="Crea las cuentas de psicólogos y staff. El registro público solo crea pacientes." />
          <QuickCard href="/admin/clinical-assignments" icon="users" title="Asignaciones clínicas" description="Asigna pacientes a psicólogos y finaliza relaciones de atención." />
          <QuickCard href="/admin/alerts" icon="bell" title="Alertas de seguimiento" description="Inactividad, inasistencias repetidas o pacientes sin primera sesión."
            badge={overview?.alerts ? <StatusPill tone="amber">{overview.alerts}</StatusPill> : undefined} />
        </div>
      </section>
    </>
  );
}

const TONES = {
  green: 'border-[rgba(54,91,69,0.13)] bg-paper [--accent:var(--forest)] [--accent-bg:var(--mint)]',
  gray: 'border-border bg-paper [--accent:var(--ink-soft)] [--accent-bg:var(--muted)]',
  amber: 'border-amber-300 bg-amber-50/60 [--accent:#92400e] [--accent-bg:#fef3c7]',
} as const;

function Metric({ icon, label, value, suffix = '', tone, href }: {
  icon: 'link' | 'clock' | 'bell';
  label: string;
  value: number | null;
  suffix?: string;
  tone: keyof typeof TONES;
  href: string;
}) {
  return (
    <Link href={href} className={`flex items-center gap-4 rounded-[18px] border p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${TONES[tone]}`}>
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-[var(--accent-bg)] text-[var(--accent)]"><Icon name={icon} size={22} /></span>
      <span>
        <span className="block font-serif text-3xl leading-none text-[var(--accent)] tabular-nums">{value === null ? '—' : `${value}${suffix}`}</span>
        <span className="mt-1 block text-sm font-semibold text-foreground">{label}</span>
      </span>
    </Link>
  );
}
