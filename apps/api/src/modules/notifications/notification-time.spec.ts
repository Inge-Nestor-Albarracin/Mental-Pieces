import {
  appointmentStartUtc,
  formatClock,
  formatLongDate,
  reminderInstant,
} from './notification-time';

describe('notification time (America/Bogota, UTC-5, no DST)', () => {
  it('converts a Bogotá slot to the right UTC instant', () => {
    expect(appointmentStartUtc('2026-10-26', 9 * 60).toISOString()).toBe(
      '2026-10-26T14:00:00.000Z',
    );
    // Bogotá midnight and late evening cross the UTC date boundary correctly.
    expect(appointmentStartUtc('2026-10-26', 0).toISOString()).toBe(
      '2026-10-26T05:00:00.000Z',
    );
    expect(appointmentStartUtc('2026-12-31', 21 * 60).toISOString()).toBe(
      '2027-01-01T02:00:00.000Z',
    );
  });

  it('does not depend on the server time zone', () => {
    const original = process.env.TZ;
    process.env.TZ = 'Asia/Tokyo';
    try {
      expect(appointmentStartUtc('2026-03-08', 7 * 60).toISOString()).toBe(
        '2026-03-08T12:00:00.000Z',
      );
    } finally {
      process.env.TZ = original;
    }
  });

  it('schedules the reminder exactly 24 h before the start', () => {
    const now = new Date('2026-10-20T12:00:00Z');
    expect(reminderInstant('2026-10-26', 9 * 60, now)?.toISOString()).toBe(
      '2026-10-25T14:00:00.000Z',
    );
  });

  it('gives no reminder when less than 24 h remain (confirmation only)', () => {
    const start = appointmentStartUtc('2026-10-26', 9 * 60);
    const justInside = new Date(start.getTime() - 23 * 60 * 60 * 1000);
    expect(reminderInstant('2026-10-26', 9 * 60, justInside)).toBeNull();
    const exactly24h = new Date(start.getTime() - 24 * 60 * 60 * 1000);
    expect(reminderInstant('2026-10-26', 9 * 60, exactly24h)).toBeNull();
  });

  it('formats dates and times in Spanish', () => {
    expect(formatLongDate('2026-10-26')).toBe('lunes, 26 de octubre de 2026');
    expect(formatClock(9 * 60)).toMatch(/^9:00\s?a\.\s?m\.$/);
    expect(formatClock(14 * 60 + 30)).toMatch(/^2:30\s?p\.\s?m\.$/);
  });
});
