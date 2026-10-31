// Reception desk helpers (no runtime imports besides types: testable in Node).
import type { BookingBlocker, DeskAppointment } from './api';
import { appointmentErrorMessage } from './appointments';

export const BLOCKER_LABEL: Record<BookingBlocker, string> = {
  PROFILE_INCOMPLETE: 'Perfil incompleto: el paciente debe completar nombre, fecha de nacimiento, género y teléfono.',
  DATA_POLICY: 'No ha aceptado la Política de Tratamiento de Datos: debe ingresar a la app y aceptarla.',
  MINOR: 'Menor de 18 años: no se agenda en línea.',
};

export const AGENDA_RANGES = [
  { days: 7, label: '7 días' },
  { days: 14, label: '14 días' },
  { days: 30, label: '30 días' },
] as const;

// For reception the API's 409 explains exactly what blocks the booking (profile, policy,
// limit, overlapping appointment); show it instead of the generic "slot taken" text.
export function deskBookingErrorMessage(error: unknown): string {
  const status = (error as { status?: unknown })?.status;
  const message = error instanceof Error ? error.message : '';
  if (status === 409 && message) return message;
  if (status === 404 && /paciente/i.test(message)) return message;
  return appointmentErrorMessage(error, 'book');
}

// Appointments grouped by calendar date, keeping the API order (date, then time).
export function groupByDate(appointments: DeskAppointment[]): [string, DeskAppointment[]][] {
  const groups = new Map<string, DeskAppointment[]>();
  for (const item of appointments) {
    const list = groups.get(item.appointmentDate);
    if (list) list.push(item);
    else groups.set(item.appointmentDate, [item]);
  }
  return [...groups.entries()];
}
