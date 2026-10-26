import { NotificationType } from '../../../../generated/prisma/enums';
import { formatClock, formatLongDate } from '../notification-time';

// Privacy by design: messages carry ONLY a general text, the date/time and a link to
// the app. No names, psychologist, diagnoses, reasons, notes or tokens. Subjects are
// discreet. No remote images or tracking pixels. Every dynamic value is escaped.

export interface TemplateInput {
  type: NotificationType;
  appointmentDate: string;
  startMinute: number;
  endMinute: number;
  appUrl: string;
  test?: boolean;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const COPY: Record<
  NotificationType,
  { subject: string; title: string; intro: string; outro: string }
> = {
  APPOINTMENT_CONFIRMATION: {
    subject: 'Confirmación de tu cita',
    title: 'Tu cita quedó agendada',
    intro: 'Te confirmamos la siguiente cita en Mental Pieces:',
    outro:
      'Si necesitas cambiarla o cancelarla, puedes hacerlo desde la aplicación antes de que comience.',
  },
  APPOINTMENT_REMINDER: {
    subject: 'Recordatorio de cita',
    title: 'Te recordamos tu próxima cita',
    intro: 'Este es un recordatorio de tu cita en Mental Pieces:',
    outro:
      'Si ya no puedes asistir, cancélala o cámbiala desde la aplicación. Puedes desactivar estos recordatorios en tu perfil.',
  },
  APPOINTMENT_CANCELLATION: {
    subject: 'Cancelación de tu cita',
    title: 'Tu cita fue cancelada',
    intro: 'La siguiente cita en Mental Pieces fue cancelada:',
    outro: 'Cuando quieras, puedes agendar una nueva cita desde la aplicación.',
  },
  APPOINTMENT_RESCHEDULE: {
    subject: 'Cambio de horario de tu cita',
    title: 'Tu cita tiene un nuevo horario',
    intro: 'Este es el nuevo horario de tu cita en Mental Pieces:',
    outro: 'El horario anterior ya no es válido.',
  },
};

const FOOTER =
  'Recibes este correo porque tienes una cuenta en Mental Pieces. Por tu privacidad no incluimos detalles de tu atención. Si no reconoces esta cita, ingresa a tu cuenta.';
const EMERGENCY =
  'Mental Pieces no atiende emergencias. Si tú o alguien más está en riesgo, llama de inmediato a la línea 123.';

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderNotificationEmail(input: TemplateInput): RenderedEmail {
  const copy = COPY[input.type];
  const date = formatLongDate(input.appointmentDate);
  const time = `${formatClock(input.startMinute)} – ${formatClock(input.endMinute)} (hora de Colombia)`;
  const link = `${input.appUrl}/appointments`;
  const subject = input.test ? `[Prueba] ${copy.subject}` : copy.subject;
  const e = escapeHtml;

  const text = [
    copy.title,
    '',
    copy.intro,
    `Fecha: ${date}`,
    `Hora: ${time}`,
    '',
    copy.outro,
    `Ver mis citas: ${link}`,
    '',
    '—',
    FOOTER,
    EMERGENCY,
  ].join('\n');

  const html = `<!doctype html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<title>${e(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f5f0eb;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f0eb;padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#fffdf9;border:1px solid #e6ddd2;border-radius:16px;">
<tr><td style="padding:28px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0;font-size:13px;font-weight:bold;letter-spacing:2px;text-transform:uppercase;color:#365b45;">Mental Pieces</p>
<h1 style="margin:14px 0 8px;font-family:Georgia,'Times New Roman',serif;font-weight:normal;font-size:26px;line-height:1.25;color:#2c2420;">${e(copy.title)}</h1>
<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:#4a4540;">${e(copy.intro)}</p>
</td></tr>
<tr><td style="padding:0 28px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9f1eb;border-radius:12px;">
<tr><td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;color:#294637;">
<p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Fecha</p>
<p style="margin:0 0 12px;font-size:17px;font-weight:bold;">${e(date)}</p>
<p style="margin:0 0 6px;font-size:12px;text-transform:uppercase;letter-spacing:1px;">Hora</p>
<p style="margin:0;font-size:17px;font-weight:bold;">${e(time)}</p>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:18px 28px 8px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0 0 20px;font-size:15px;line-height:1.6;color:#4a4540;">${e(copy.outro)}</p>
<a href="${e(link)}" style="display:inline-block;background:#365b45;color:#ffffff;text-decoration:none;font-weight:bold;font-size:15px;padding:13px 22px;border-radius:10px;">Ver mis citas</a>
</td></tr>
<tr><td style="padding:24px 28px 28px;font-family:Arial,Helvetica,sans-serif;">
<p style="margin:0 0 10px;font-size:12px;line-height:1.6;color:#6b645e;">${e(FOOTER)}</p>
<p style="margin:0;font-size:12px;line-height:1.6;color:#6b645e;">${e(EMERGENCY)}</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  return { subject, html, text };
}
