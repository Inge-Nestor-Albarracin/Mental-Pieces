// Shared by server and client components (no 'use client').

export type ShellRole = 'PATIENT' | 'PSYCHOLOGIST' | 'ADMIN' | 'STAFF';

const HOME: Record<ShellRole, string> = {
  PATIENT: '/dashboard',
  PSYCHOLOGIST: '/psychologist/dashboard',
  ADMIN: '/admin/dashboard',
  STAFF: '/staff/dashboard',
};

export const NAV_LINKS: Record<ShellRole, [string, string][]> = {
  PATIENT: [['/dashboard', 'Inicio'], ['/appointments', 'Mis citas'], ['/appointments/new', 'Agendar cita'], ['/profile', 'Mi perfil']],
  PSYCHOLOGIST: [['/psychologist/dashboard', 'Inicio'], ['/psychologist/appointments', 'Mi agenda'], ['/psychologist/patients', 'Mis pacientes'], ['/psychologist/alerts', 'Alertas'], ['/psychologist/availability', 'Disponibilidad']],
  ADMIN: [['/admin/dashboard', 'Inicio'], ['/admin/clinical-assignments', 'Asignaciones'], ['/admin/users', 'Usuarios'], ['/admin/alerts', 'Alertas']],
  STAFF: [['/staff/dashboard', 'Agenda de psicólogos'], ['/staff/appointments/new', 'Agendar cita']],
};

export const ROLE_LABEL: Record<ShellRole, string> = {
  PATIENT: 'Portal del paciente',
  PSYCHOLOGIST: 'Portal del psicólogo',
  ADMIN: 'Administración',
  STAFF: 'Recepción',
};

export function homeHref(role: ShellRole): string {
  return HOME[role];
}
