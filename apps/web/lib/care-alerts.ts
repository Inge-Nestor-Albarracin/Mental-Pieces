import type { CareAlert, CareAlertReason, CareAlertRules } from './api';

// Pure presentation helpers. The server decides which alerts exist.

export function reasonLabel(reason: CareAlertReason, alert: CareAlert, rules: CareAlertRules): string {
  switch (reason) {
    case 'NO_SHOW_STREAK':
      return `${alert.noShowsSinceLastSession} inasistencias desde la última sesión (umbral: ${rules.noShowStreak}).`;
    case 'INACTIVE':
      return `${alert.daysSinceLastSession} días sin sesión y sin próxima cita (umbral: ${rules.inactiveDays}).`;
    case 'NO_FIRST_SESSION':
      return `Asignado hace ${alert.daysSinceAssigned} días, sin primera sesión ni cita programada (umbral: ${rules.noFirstSessionDays}).`;
    case 'NO_SHOW_WITHOUT_FOLLOW_UP':
      return 'Una inasistencia tras la última sesión y ninguna cita de seguimiento programada.';
  }
}

export const LEVEL_LABEL: Record<CareAlert['level'], string> = {
  HIGH: 'Prioridad alta',
  MEDIUM: 'Seguimiento',
};
