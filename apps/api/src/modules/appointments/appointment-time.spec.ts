import { hasAppointmentEnded } from './appointment-time';

describe('Appointment completion time in America/Bogota', () => {
  it.each([
    ['2026-09-28', 600, '2026-09-28T14:59:59.999Z', false],
    ['2026-09-28', 600, '2026-09-28T15:00:00.000Z', true],
    ['2026-09-28', 600, '2026-09-28T15:00:01.000Z', true],
    ['2026-09-29', 600, '2026-09-28T20:00:00.000Z', false],
    ['2026-09-27', 1440, '2026-09-28T04:59:59.999Z', false],
    ['2026-09-27', 1440, '2026-09-28T05:00:00.000Z', true],
    ['2026-09-28', 60, '2026-09-28T05:00:00.000Z', false],
    ['2026-09-27', 1380, '2026-09-28T03:59:59.000Z', false],
    ['2026-09-27', 1380, '2026-09-28T04:00:00.000Z', true],
    ['2026-09-26', 1440, '2026-09-28T03:00:00.000Z', true],
  ])(
    'date %s ending at %i at server instant %s returns %s',
    (date, minute, instant, expected) => {
      expect(hasAppointmentEnded(date, minute, new Date(instant))).toBe(
        expected,
      );
    },
  );

  it.each([
    ['not-a-date', 600],
    ['2026-02-30', 600],
    ['2026-09-28', -1],
    ['2026-09-28', 1441],
  ])('fails closed on invalid stored values: %s %s', (date, minute) => {
    expect(
      hasAppointmentEnded(date, minute, new Date('2026-10-01T12:00:00Z')),
    ).toBe(false);
  });
});
