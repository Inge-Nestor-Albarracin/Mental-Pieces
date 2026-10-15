// Shared by server and client components (no 'use client').

export type ShellRole = 'PATIENT' | 'PSYCHOLOGIST' | 'ADMIN';

const HOME: Record<ShellRole, string> = {
  PATIENT: '/dashboard',
  PSYCHOLOGIST: '/psychologist/dashboard',
  ADMIN: '/admin/dashboard',
};

export const NAV_LINKS: Record<ShellRole, [string, string][]> = {
  PATIENT: [['/dashboard', 'Inicio'], ['/appointments', 'Mis citas'], ['/appointments/new', 'Agendar cita'], ['/profile', 'Mi perfil']],
  PSYCHOLOGIST: [['/psychologist/dashboard', 'Inicio'], ['/psychologist/appointments', 'Mi agenda'], ['/psychologist/patients', 'Mis pacientes'], ['/psychologist/alerts', 'Alertas'], ['/psychologist/availability', 'Disponibilidad']],
  ADMIN: [['/admin/dashboard', 'Inicio'], ['/admin/clinical-assignments', 'Asignaciones'], ['/admin/alerts', 'Alertas']],
};

export const ROLE_LABEL: Record<ShellRole, string> = {
  PATIENT: 'Portal del paciente',
  PSYCHOLOGIST: 'Portal del psicólogo',
  ADMIN: 'Administración',
};

export function homeHref(role: ShellRole): string {
  return HOME[role];
}
