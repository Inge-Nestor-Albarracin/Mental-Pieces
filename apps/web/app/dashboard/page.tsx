'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

import { ApiErrorNotice } from '../../components/api-error-notice';
import { AppointmentCard } from '../../components/appointment-tabs';
import { EmptyState, Hero, Icon, QuickCard, SectionHeading, TextLink } from '../../components/ui';
import { getMyAppointments, getMyProfile, type AppointmentSummary, type PatientProfile } from '../../lib/api';
import { businessNow, displayStatus, splitAppointments } from '../../lib/appointments';
import { firstName } from '../../lib/profile';
import { portalError, withSession } from '../../lib/psychologist';

export default function DashboardPage() {
  const [profile, setProfile] = useState<PatientProfile | null>(null);
  const [appointments, setAppointments] = useState<AppointmentSummary[]>([]);
  const [error, setError] = useState<Error | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    withSession((token) => Promise.all([getMyProfile(token), getMyAppointments(token)]))
      .then(([profileResult, appointmentResult]) => {
        if (!active) return;
        setProfile(profileResult);
        setAppointments(appointmentResult);
      })
      .catch((caught: unknown) => {
        if (active) setError(portalError(caught, 'No fue posible cargar tu información. Revisa tu conexión y reintenta.'));
      });
    return () => { active = false; };
  }, [revision]);

  if (error) {
    return <ApiErrorNotice error={error} onRetry={() => { setError(null); setRevision((value) => value + 1); }} messages={{ 404: 'No se encontró tu perfil de paciente.' }} />;
  }
  if (!profile) {
    return <p role="status" className="surface p-6 text-sm text-muted-foreground">Cargando tu espacio...</p>;
  }

  const now = businessNow();
  // A past SCHEDULED appointment is history ("pendiente de cierre"), never "next".
  const nextAppointment = splitAppointments(appointments, now).upcoming[0] ?? null;

  return (
    <>
      <Hero
        eyebrow="Tu espacio de bienestar"
        title={`Hola, ${firstName(profile.fullName)}`}
        description="Organiza tus sesiones con calma y continúa acompañando tu proceso."
        actions={<>
          <Link href="/appointments/new" className="btn btn-on-dark">Agendar una cita <Icon name="arrow" size={18} /></Link>
          <Link href="/appointments" className="btn btn-ghost-on-dark">Ver mis citas</Link>
        </>}
        note={{ title: 'Un paso a la vez', text: 'Estamos para acompañarte' }}
      />

      {!profile.isProfileComplete && (
        <section className="mt-6 flex flex-col gap-4 rounded-[22px] border-2 border-amber-300 bg-amber-50 p-5 sm:flex-row sm:items-center sm:p-6">
          <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-[13px] bg-amber-100 text-amber-900"><Icon name="alert" size={22} /></span>
          <div className="flex-1">
            <h2 className="font-semibold text-amber-950">Completa tu perfil</h2>
            <p className="mt-1 text-sm text-amber-900">Necesitamos algunos datos básicos antes de habilitar todas las funciones.</p>
          </div>
          <Link href="/profile/edit" className="btn btn-primary">Completar perfil</Link>
        </section>
      )}

      <section className="mt-12" aria-labelledby="next-title">
        <SectionHeading eyebrow="Tu agenda" title="Próxima cita" id="next-title" action={<TextLink href="/appointments">Ver todas las citas</TextLink>} />
        {nextAppointment ? (
          <ul>
            <AppointmentCard appointmentDate={nextAppointment.appointmentDate} startTime={nextAppointment.startTime} endTime={nextAppointment.endTime}
              status={displayStatus(nextAppointment, now)} person={nextAppointment.psychologist.fullName ?? 'Psicólogo'}>
              <Link href="/appointments" className="btn btn-secondary w-full sm:w-auto">Gestionar cita <Icon name="arrow" size={17} /></Link>
            </AppointmentCard>
          </ul>
        ) : (
          <EmptyState title="No tienes citas programadas" text="Agenda tu próxima sesión cuando lo necesites."
            action={<Link href="/appointments/new" className="btn btn-primary w-full sm:w-auto">Agendar cita</Link>} />
        )}
      </section>

      <section className="mt-12" aria-labelledby="quick-title">
        <SectionHeading eyebrow="Todo en un solo lugar" title="Accesos rápidos" id="quick-title" />
        <div className="grid gap-4 md:grid-cols-3">
          <QuickCard href="/appointments/new" icon="calendar" title="Agendar cita" description="Elige psicólogo, fecha y horario disponible." />
          <QuickCard href="/appointments" icon="check" title="Mis citas" description="Consulta tus próximas sesiones e historial." />
          <QuickCard href="/profile" icon="profile" title="Mi perfil" description={`Revisa tus datos · Paciente ${profile.mrn}`} />
        </div>
      </section>
    </>
  );
}
