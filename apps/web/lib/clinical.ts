import type { PsychologistAppointment } from './api';

// Pure helpers (no runtime imports) so they can be tested without React or a server.

export const CLINICAL_ACCESS_DENIED = 'No fue posible acceder al recurso clínico.';
export const NOTE_ALREADY_LINKED = 'Esta cita ya tiene una nota clínica asociada.';
export const NOTE_MAX_LENGTH = 10000;
export const ASSIGNMENT_EXISTS =
  'Esta relación ya existe (activa o finalizada). La reactivación todavía no está disponible.';

function statusOf(error: unknown): number | undefined {
  return error instanceof Error && 'status' in error && typeof error.status === 'number'
    ? error.status
    : undefined;
}

// 401/403/404 mean the clinical view must be wiped: session lost, role lost or relationship ended.
// A 404 is never explained further, so a foreign patientId looks the same as a missing one.
export function revokesClinicalAccess(error: unknown): boolean {
  const status = statusOf(error);
  return status === 401 || status === 403 || status === 404;
}

export function noteErrorMessage(error: unknown): string {
  const status = statusOf(error);
  if (status === 409) return NOTE_ALREADY_LINKED;
  if (status === 404) return CLINICAL_ACCESS_DENIED;
  if (status === 400 && error instanceof Error) return error.message;
  return 'No fue posible guardar la nota clínica. Intenta de nuevo.';
}

export function assignmentErrorMessage(error: unknown, action: 'create' | 'end'): string {
  const status = statusOf(error);
  if (action === 'create' && status === 409) return ASSIGNMENT_EXISTS;
  if (action === 'create' && status === 404)
    return 'El paciente o el psicólogo ya no están disponibles. Actualiza las listas.';
  if (action === 'end' && status === 409) return 'Esta relación clínica ya estaba finalizada.';
  if (action === 'end' && status === 404) return 'La relación clínica ya no existe. Actualiza la lista.';
  if (status === 400 && error instanceof Error) return error.message;
  return action === 'create'
    ? 'No fue posible crear la asignación. Intenta de nuevo.'
    : 'No fue posible finalizar la asignación. Intenta de nuevo.';
}

// UX filter only: the API re-validates patient, author and COMPLETED status on every note.
export function completedAppointmentsFor(
  appointments: PsychologistAppointment[],
  patientId: string,
): PsychologistAppointment[] {
  return appointments
    .filter((item) => item.status === 'COMPLETED' && item.patient.id === patientId)
    .sort((a, b) =>
      b.appointmentDate.localeCompare(a.appointmentDate) || b.startTime.localeCompare(a.startTime));
}
