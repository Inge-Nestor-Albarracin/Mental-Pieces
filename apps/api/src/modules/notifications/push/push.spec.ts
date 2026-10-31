import {
  AppointmentStatus,
  NotificationType,
  UserRole,
} from '../../../../generated/prisma/enums';
import { NotificationsConfigError } from '../notifications-config';
import {
  decidePushDelivery,
  type QueuedPushNotification,
} from '../notification-rules';
import { loadPushConfig } from './push-config';
import { isAllowedPushEndpoint } from './push-endpoint';
import { renderPushMessage } from './push-messages';
import { classifyPushFailure, PushDeliveryError } from './push-sender';

const PUBLIC_KEY = `B${'A'.repeat(86)}`;
const PRIVATE_KEY = 'a'.repeat(43);
const NOW = new Date('2026-11-02T15:00:00Z'); // 10:00 in Bogotá
const HOUR = 60 * 60 * 1000;

describe('loadPushConfig', () => {
  it('is disabled unless PUSH_ENABLED=true', () => {
    expect(loadPushConfig({}).enabled).toBe(false);
    expect(loadPushConfig({ PUSH_ENABLED: 'false' }).enabled).toBe(false);
  });

  it('accepts valid VAPID keys and subject', () => {
    const config = loadPushConfig({
      PUSH_ENABLED: 'true',
      VAPID_PUBLIC_KEY: PUBLIC_KEY,
      VAPID_PRIVATE_KEY: PRIVATE_KEY,
      VAPID_SUBJECT: 'mailto:contacto@example.com',
    });
    expect(config).toMatchObject({ enabled: true, publicKey: PUBLIC_KEY });
  });

  it('names the invalid variables without printing their values', () => {
    try {
      loadPushConfig({
        PUSH_ENABLED: 'true',
        VAPID_PUBLIC_KEY: 'short',
        VAPID_PRIVATE_KEY: 'secret-value',
        VAPID_SUBJECT: 'nope',
      });
      throw new Error('expected a configuration error');
    } catch (error) {
      expect(error).toBeInstanceOf(NotificationsConfigError);
      const message = (error as Error).message;
      expect(message).toContain('VAPID_PUBLIC_KEY');
      expect(message).toContain('VAPID_PRIVATE_KEY');
      expect(message).toContain('VAPID_SUBJECT');
      expect(message).not.toContain('secret-value');
    }
  });
});

describe('isAllowedPushEndpoint (SSRF guard)', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/abc',
    'https://web.push.apple.com/QGx',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
  ])('accepts the browser push service %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc',
    'https://fcm.googleapis.com.evil.example/fcm',
    'https://127.0.0.1/admin',
    'https://localhost:3001/staff',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'not a url',
    `https://fcm.googleapis.com/${'a'.repeat(1001)}`,
  ])('rejects %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('renderPushMessage', () => {
  it('carries only date, time and a same-origin link (no names)', () => {
    const message = renderPushMessage({
      type: NotificationType.STAFF_NEW_BOOKING,
      audience: 'STAFF',
      appointmentId: 'c123',
      appointmentDate: '2026-11-05',
      startMinute: 10 * 60,
    });
    expect(message.title).toBe('Nueva cita agendada');
    expect(message.body).toContain('5 de noviembre');
    expect(message.url).toBe('/staff/dashboard');
    expect(message.tag).toBe('appointment-c123');
  });

  it('sends patients and psychologists to their own agenda', () => {
    const base = {
      type: NotificationType.APPOINTMENT_CONFIRMATION,
      appointmentId: 'c1',
      appointmentDate: '2026-11-05',
      startMinute: 600,
    };
    expect(renderPushMessage({ ...base, audience: 'PATIENT' }).url).toBe(
      '/appointments',
    );
    expect(renderPushMessage({ ...base, audience: 'PSYCHOLOGIST' }).url).toBe(
      '/psychologist/appointments',
    );
  });
});

describe('classifyPushFailure', () => {
  it('marks 404/410 as gone (subscription must be deleted)', () => {
    expect(classifyPushFailure({ statusCode: 410 })).toMatchObject({
      code: 'PUSH_410',
      gone: true,
      transient: false,
    });
  });

  it('retries rate limits, server errors and network failures', () => {
    expect(classifyPushFailure({ statusCode: 429 }).transient).toBe(true);
    expect(classifyPushFailure({ statusCode: 503 }).transient).toBe(true);
    expect(classifyPushFailure({ code: 'ETIMEDOUT' })).toMatchObject({
      code: 'ETIMEDOUT',
      transient: true,
    });
  });

  it('never leaks free text as the code', () => {
    expect(classifyPushFailure(new Error('secret body')).code).toBe(
      'PUSH_ERROR',
    );
    const known = new PushDeliveryError('PUSH_400', false);
    expect(classifyPushFailure(known)).toBe(known);
  });
});

describe('decidePushDelivery', () => {
  const patientUserId = 'patient-user';
  const psychologistId = 'psy-user';
  const queued = (
    overrides: Partial<QueuedPushNotification> = {},
  ): QueuedPushNotification => ({
    type: NotificationType.APPOINTMENT_CONFIRMATION,
    recipientUserId: patientUserId,
    appointmentDate: '2026-11-05',
    startMinute: 600,
    createdAt: new Date(NOW.getTime() - HOUR),
    recipient: { role: UserRole.PATIENT, isActive: true },
    appointment: {
      status: AppointmentStatus.SCHEDULED,
      appointmentDate: '2026-11-05',
      startMinute: 600,
      endMinute: 660,
      patient: { userId: patientUserId },
      psychologistId,
    },
    ...overrides,
  });

  it('sends a confirmation to the patient of the appointment', () => {
    expect(decidePushDelivery(queued(), NOW, 12 * HOUR)).toEqual({
      send: true,
      audience: 'PATIENT',
      endMinute: 660,
    });
  });

  it('sends the booking alert only to an active STAFF account', () => {
    const alert = queued({
      type: NotificationType.STAFF_NEW_BOOKING,
      recipientUserId: 'staff-user',
      recipient: { role: UserRole.STAFF, isActive: true },
    });
    expect(decidePushDelivery(alert, NOW, 12 * HOUR)).toMatchObject({
      send: true,
      audience: 'STAFF',
    });
    expect(
      decidePushDelivery(
        { ...alert, recipient: { role: UserRole.PATIENT, isActive: true } },
        NOW,
        12 * HOUR,
      ),
    ).toEqual({ send: false, reason: 'RECIPIENT_MISMATCH' });
    expect(
      decidePushDelivery(
        { ...alert, recipient: { role: UserRole.STAFF, isActive: false } },
        NOW,
        12 * HOUR,
      ),
    ).toEqual({ send: false, reason: 'RECIPIENT_INACTIVE' });
  });

  it('drops an alert for an appointment that was cancelled meanwhile', () => {
    const alert = queued({
      type: NotificationType.STAFF_NEW_BOOKING,
      recipientUserId: 'staff-user',
      recipient: { role: UserRole.STAFF, isActive: true },
    });
    alert.appointment!.status = AppointmentStatus.CANCELLED;
    expect(decidePushDelivery(alert, NOW, 12 * HOUR)).toEqual({
      send: false,
      reason: 'STALE',
    });
  });

  it('never sends a reminder to the psychologist', () => {
    expect(
      decidePushDelivery(
        queued({
          type: NotificationType.APPOINTMENT_REMINDER,
          recipientUserId: psychologistId,
          recipient: { role: UserRole.PSYCHOLOGIST, isActive: true },
        }),
        NOW,
        12 * HOUR,
      ),
    ).toEqual({ send: false, reason: 'NOT_FOR_AUDIENCE' });
  });

  it('rejects a recipient unrelated to the appointment', () => {
    expect(
      decidePushDelivery(
        queued({ recipientUserId: 'someone-else' }),
        NOW,
        12 * HOUR,
      ),
    ).toEqual({ send: false, reason: 'RECIPIENT_MISMATCH' });
  });

  it('does not push stale confirmations late', () => {
    expect(
      decidePushDelivery(
        queued({ createdAt: new Date(NOW.getTime() - 13 * HOUR) }),
        NOW,
        12 * HOUR,
      ),
    ).toEqual({ send: false, reason: 'EXPIRED' });
  });
});
