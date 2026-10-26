import { NotificationType } from '../../../../generated/prisma/enums';
import { escapeHtml, renderNotificationEmail } from './email-templates';

const base = {
  appointmentDate: '2026-10-26',
  startMinute: 9 * 60,
  endMinute: 10 * 60,
  appUrl: 'https://mentalpieces.site',
};
const TYPES = Object.values(NotificationType);

describe('email templates', () => {
  it.each(TYPES)('%s has a discreet subject, HTML and plain text', (type) => {
    const email = renderNotificationEmail({ ...base, type });
    expect(email.subject).toMatch(/cita/i);
    // Subjects never reveal psychological details.
    expect(email.subject).not.toMatch(/psic|terap|salud mental|sesión/i);
    for (const body of [email.html, email.text]) {
      expect(body).toContain('lunes, 26 de octubre de 2026');
      expect(body).toContain('https://mentalpieces.site/appointments');
    }
    expect(email.html).toMatch(/^<!doctype html>/);
    expect(email.html).toContain('<meta charset="utf-8">');
  });

  it.each(TYPES)(
    '%s carries no clinical content, tokens or tracking',
    (type) => {
      const { html, text, subject } = renderNotificationEmail({
        ...base,
        type,
      });
      const all = `${subject}\n${html}\n${text}`;
      expect(all).not.toMatch(
        /diagn[oó]stic|s[ií]ntoma|motivo de consulta|nota cl[ií]nica|observaci[oó]n/i,
      );
      expect(all).not.toMatch(/token|jwt|Bearer|eyJ/i);
      // No remote resources: no images, scripts or external stylesheets.
      expect(html).not.toMatch(/<img|<script|<link|url\(/i);
      const links = html.match(/https?:\/\/[^"'\s<]+/g) ?? [];
      expect(
        links.every((link) => link.startsWith('https://mentalpieces.site/')),
      ).toBe(true);
    },
  );

  it('keeps Spanish characters (UTF-8)', () => {
    const { html, text } = renderNotificationEmail({
      ...base,
      type: NotificationType.APPOINTMENT_CONFIRMATION,
    });
    expect(text).toContain('Tu cita quedó agendada');
    expect(html).toContain('Confirmación');
    expect(html).toMatch(/9:00\sa\.\s?m\./);
  });

  it('escapes every dynamic value (HTML injection)', () => {
    expect(escapeHtml(`<script>"x"&'y'</script>`)).toBe(
      '&lt;script&gt;&quot;x&quot;&amp;&#39;y&#39;&lt;/script&gt;',
    );
    const { html } = renderNotificationEmail({
      ...base,
      type: NotificationType.APPOINTMENT_CONFIRMATION,
      appUrl: 'https://mentalpieces.site/"><script>alert(1)</script>',
    });
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('&lt;script&gt;');
  });

  it.each([
    [NotificationType.APPOINTMENT_CONFIRMATION, 'Nueva cita agendada'],
    [NotificationType.APPOINTMENT_RESCHEDULE, 'Cita con nuevo horario'],
    [NotificationType.APPOINTMENT_CANCELLATION, 'Cita cancelada'],
  ])(
    'psychologist version of %s links to the agenda, without patient data',
    (type, subject) => {
      const email = renderNotificationEmail({
        ...base,
        type,
        audience: 'PSYCHOLOGIST',
      });
      expect(email.subject).toBe(subject);
      for (const body of [email.html, email.text]) {
        expect(body).toContain(
          'https://mentalpieces.site/psychologist/appointments',
        );
        expect(body).toContain('Ver mi agenda');
        expect(body).toContain('lunes, 26 de octubre de 2026');
        expect(body).not.toContain('Ver mis citas');
      }
      expect(email.text).toContain('no incluimos datos del paciente');
    },
  );

  it('the patient version stays the default', () => {
    const email = renderNotificationEmail({
      ...base,
      type: NotificationType.APPOINTMENT_CONFIRMATION,
    });
    expect(email.subject).toBe('Confirmación de tu cita');
    expect(email.text).toContain('https://mentalpieces.site/appointments');
  });

  it('marks the SMTP test message as a test', () => {
    const { subject } = renderNotificationEmail({
      ...base,
      type: NotificationType.APPOINTMENT_CONFIRMATION,
      test: true,
    });
    expect(subject).toBe('[Prueba] Confirmación de tu cita');
  });
});
