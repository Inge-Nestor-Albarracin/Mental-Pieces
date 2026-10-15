'use client';

import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { AppointmentCard } from '../../../components/appointment-tabs';
import { EmptyState, Hero, Icon, QuickCard, SectionHeading, StatusPill, TextLink, type IconName } from '../../../components/ui';
import { getMyCareAlerts, getPsychologistAppointments, type PsychologistAppointment } from '../../../lib/api';
import { businessNow, canPsychologistClose, displayStatus, splitAppointments } from '../../../lib/appointments';
import { withSession } from '../../../lib/psychologist';

interface Overview {
  appointments: PsychologistAppointment[] | null;
  alerts: { total: number; high: number } | null;
}

export default function PsychologistDashboardPage() {
  const [overview, setOverview] = useState<Overview | null>(null);

  // Summary only: each section keeps its own detailed view and error handling.
  useEffect(() => {
    let active = true;
    Promise.allSettled([
      withSession(getPsychologistAppointments),
      withSession((token) => getMyCareAlerts(token, 1)),
    ]).then(([agenda, alerts]) => {
      if (!active) return;
      setOverview({
        appointments: agenda.status === 'fulfilled' ? agenda.value : null,
        alerts: alerts.status === 'fulfilled'
          ? { total: alerts.value.total, high: alerts.value.items.filter((item) => item.level === 'HIGH').length }
          : null,
      });
    });
    return () => { active = false; };
  }, []);

  const now = businessNow();
  const split = overview?.appointments ? splitAppointments(overview.appointments, now) : null;
  const pending = split ? split.history.filter((item) => canPsychologistClose(item, now)).length : null;
  const today = split ? split.upcoming.filter((item) => item.appointmentDate === now.date).length : null;
  const next = split?.upcoming[0] ?? null;

  return (
    <>
      <Hero
        eyebrow="Portal del psicólogo"
        title="Tu espacio de trabajo"
        description="Revisa tu agenda, cierra las sesiones pasadas y acompaña a tus pacientes asignados."
        actions={<>
          <Link href="/psychologist/appointments" className="btn btn-on-dark">Abrir mi agenda <Icon name="arrow" size={18} /></Link>
          <Link href="/psychologist/patients" className="btn btn-ghost-on-dark">Mis pacientes</Link>
        </>}
        note={{ title: 'Datos clínicos protegidos', text: 'Solo ves tus propias notas', icon: 'shield' }}
      />

      <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-label="Resumen">
        <Stat icon="calendar" label="Citas hoy" value={today} tone="green" href="/psychologist/appointments" />
        <Stat icon="clock" label="Pendientes de cierre" value={pending} tone={pending ? 'amber' : 'green'} href="/psychologist/appointments"
          hint={pending ? 'Marca realizada o inasistencia' : 'Todo al día'} />
        <Stat icon="bell" label="Alertas de seguimiento" value={overview?.alerts?.total ?? null} tone={overview?.alerts?.high ? 'red' : overview?.alerts?.total ? 'amber' : 'green'}
          href="/psychologist/alerts" hint={overview?.alerts?.high ? `${overview.alerts.high} de prioridad alta` : undefined} />
        <Stat icon="check" label="Próximas citas" value={split ? split.upcoming.length : null} tone="green" href="/psychologist/appointments" />
      </section>

      <section className="mt-12" aria-labelledby="next-session">
        <SectionHeading eyebrow="Tu agenda" title="Próxima sesión" id="next-session" action={<TextLink href="/psychologist/appointments">Ver agenda completa</TextLink>} />
        {!overview ? (
          <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando agenda...</p>
        ) : next ? (
          <ul>
            <AppointmentCard appointmentDate={next.appointmentDate} startTime={next.startTime} endTime={next.endTime}
              status={displayStatus(next, now)} person={next.patient.fullName?.trim() || 'Paciente sin nombre registrado'} personIcon="users" />
          </ul>
        ) : (
          <EmptyState title="No tienes próximas sesiones" text="Cuando un paciente agende contigo, la cita aparecerá aquí."
            action={<Link href="/psychologist/availability" className="btn btn-secondary w-full sm:w-auto">Revisar disponibilidad</Link>} />
        )}
      </section>

      <section className="mt-12" aria-labelledby="quick-title">
        <SectionHeading eyebrow="Todo en un solo lugar" title="Accesos rápidos" id="quick-title" />
        <div className="grid gap-4 md:grid-cols-2">
          <QuickCard href="/psychologist/appointments" icon="calendar" title="Mi agenda" description="Próximas citas, historial y cierre de sesiones." />
          <QuickCard href="/psychologist/patients" icon="users" title="Mis pacientes" description="Pacientes asignados y notas de sesión." />
          <QuickCard href="/psychologist/alerts" icon="bell" title="Alertas" description="Inactividad o inasistencias que requieren seguimiento."
            badge={overview?.alerts?.total ? <StatusPill tone={overview.alerts.high ? 'red' : 'amber'}>{overview.alerts.total}</StatusPill> : undefined} />
          <QuickCard href="/psychologist/availability" icon="clock" title="Mi disponibilidad" description="Bloques semanales en los que atiendes." />
        </div>
      </section>
    </>
  );
}

const STAT_TONE = {
  green: 'border-[rgba(54,91,69,0.13)] bg-paper [--accent:var(--forest)] [--accent-bg:var(--mint)]',
  amber: 'border-amber-300 bg-amber-50/60 [--accent:#92400e] [--accent-bg:#fef3c7]',
  red: 'border-red-300 bg-red-50/60 [--accent:#991b1b] [--accent-bg:#fee2e2]',
} as const;

function Stat({ icon, label, value, tone, href, hint }: {
  icon: IconName;
  label: string;
  value: number | null;
  tone: keyof typeof STAT_TONE;
  href: string;
  hint?: ReactNode;
}) {
  return (
    <Link href={href} className={`flex items-center gap-4 rounded-[18px] border p-4 transition hover:-translate-y-0.5 hover:shadow-[var(--shadow-soft)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-forest ${STAT_TONE[tone]}`}>
      <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-[var(--accent-bg)] text-[var(--accent)]"><Icon name={icon} size={22} /></span>
      <span className="min-w-0">
        <span className="block font-serif text-3xl leading-none text-[var(--accent)] tabular-nums">{value ?? '—'}</span>
        <span className="mt-1 block text-sm font-semibold text-foreground">{label}</span>
        {hint && <span className="block text-xs text-ink-soft">{hint}</span>}
      </span>
    </Link>
  );
}
