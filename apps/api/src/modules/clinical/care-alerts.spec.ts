import { AppointmentStatus } from '../../../generated/prisma/enums';
import {
  businessDate,
  evaluateCareAlert,
  type CareAlertAppointment,
} from './care-alerts';

// 2026-10-14 10:00 in Bogotá.
const now = new Date('2026-10-14T15:00:00Z');
const assignedLongAgo = new Date('2026-01-01T15:00:00Z');

function appt(
  appointmentDate: string,
  status: AppointmentStatus,
  startMinute = 540,
): CareAlertAppointment {
  return {
    appointmentDate,
    startMinute,
    endMinute: startMinute + 60,
    status,
  };
}

describe('Care alerts (operational, deterministic)', () => {
  it('uses the Bogotá calendar date, not UTC', () => {
    expect(businessDate(new Date('2026-10-15T03:00:00Z'))).toBe('2026-10-14');
  });

  it('no alert for a recent real session', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [appt('2026-10-01', AppointmentStatus.COMPLETED)],
        now,
      ),
    ).toBeNull();
  });

  it('inactive at 30 days without an upcoming appointment', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [appt('2026-09-14', AppointmentStatus.COMPLETED)],
        now,
      ),
    ).toMatchObject({
      level: 'MEDIUM',
      reasons: ['INACTIVE'],
      lastSessionDate: '2026-09-14',
      daysSinceLastSession: 30,
    });
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [appt('2026-09-15', AppointmentStatus.COMPLETED)],
        now,
      ),
    ).toBeNull();
  });

  it('inactivity becomes HIGH at 60 days', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [appt('2026-08-15', AppointmentStatus.COMPLETED)],
        now,
      ),
    ).toMatchObject({ level: 'HIGH', reasons: ['INACTIVE'] });
  });

  it('an upcoming SCHEDULED appointment suppresses inactivity', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [
          appt('2026-06-01', AppointmentStatus.COMPLETED),
          appt('2026-10-20', AppointmentStatus.SCHEDULED),
        ],
        now,
      ),
    ).toBeNull();
  });

  it('a past SCHEDULED appointment is not an upcoming one', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [
          appt('2026-06-01', AppointmentStatus.COMPLETED),
          appt('2026-10-14', AppointmentStatus.SCHEDULED, 480),
        ],
        now,
      ),
    ).toMatchObject({ reasons: ['INACTIVE'], nextAppointmentDate: null });
  });

  it('cancelled appointments are neither sessions nor follow-ups', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [
          appt('2026-06-01', AppointmentStatus.COMPLETED),
          appt('2026-10-20', AppointmentStatus.CANCELLED),
        ],
        now,
      ),
    ).toMatchObject({ reasons: ['INACTIVE'] });
  });

  it('two NO_SHOW after the last real session are HIGH even with a follow-up', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [
          appt('2026-10-01', AppointmentStatus.COMPLETED),
          appt('2026-10-06', AppointmentStatus.NO_SHOW),
          appt('2026-10-13', AppointmentStatus.NO_SHOW),
          appt('2026-10-20', AppointmentStatus.SCHEDULED),
        ],
        now,
      ),
    ).toMatchObject({
      level: 'HIGH',
      reasons: ['NO_SHOW_STREAK'],
      noShowsSinceLastSession: 2,
      nextAppointmentDate: '2026-10-20',
    });
  });

  it('a completed session resets the NO_SHOW count', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [
          appt('2026-09-20', AppointmentStatus.NO_SHOW),
          appt('2026-09-27', AppointmentStatus.NO_SHOW),
          appt('2026-10-04', AppointmentStatus.COMPLETED),
        ],
        now,
      ),
    ).toBeNull();
  });

  it('one NO_SHOW without a follow-up is a MEDIUM alert', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [
          appt('2026-10-01', AppointmentStatus.COMPLETED),
          appt('2026-10-08', AppointmentStatus.NO_SHOW),
        ],
        now,
      ),
    ).toMatchObject({
      level: 'MEDIUM',
      reasons: ['NO_SHOW_WITHOUT_FOLLOW_UP'],
    });
  });

  it('no first session after 14 days of assignment, HIGH after 60', () => {
    expect(
      evaluateCareAlert(new Date('2026-09-30T15:00:00Z'), [], now),
    ).toMatchObject({
      level: 'MEDIUM',
      reasons: ['NO_FIRST_SESSION'],
      daysSinceAssigned: 14,
      lastSessionDate: null,
    });
    expect(
      evaluateCareAlert(new Date('2026-10-01T15:00:00Z'), [], now),
    ).toBeNull();
    expect(evaluateCareAlert(assignedLongAgo, [], now)).toMatchObject({
      level: 'HIGH',
      reasons: ['NO_FIRST_SESSION'],
    });
  });

  it('a first appointment already scheduled suppresses the no-first-session alert', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [appt('2026-10-21', AppointmentStatus.SCHEDULED)],
        now,
      ),
    ).toBeNull();
  });

  it('combines reasons for NO_SHOW streaks without any session', () => {
    expect(
      evaluateCareAlert(
        assignedLongAgo,
        [
          appt('2026-09-01', AppointmentStatus.NO_SHOW),
          appt('2026-09-08', AppointmentStatus.NO_SHOW),
        ],
        now,
      ),
    ).toMatchObject({
      level: 'HIGH',
      reasons: ['NO_SHOW_STREAK', 'NO_FIRST_SESSION'],
      noShowsSinceLastSession: 2,
    });
  });
});
