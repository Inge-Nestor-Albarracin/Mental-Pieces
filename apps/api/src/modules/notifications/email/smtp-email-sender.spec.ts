import type { createTransport } from 'nodemailer';
import { EmailDeliveryError } from './email-sender';
import {
  classifySmtpError,
  SmtpEmailSender,
  smtpTransportOptions,
} from './smtp-email-sender';

const config = {
  host: 'smtp.hostinger.com',
  port: 465,
  secure: true,
  user: 'notificaciones@mentalpieces.site',
  password: 'valor-secreto-de-prueba',
  from: 'notificaciones@mentalpieces.site',
  fromName: 'Mental Pieces',
};

describe('SMTP sender (Nodemailer) — no real connection in tests', () => {
  it('uses TLS, verifies certificates and never fetches files or URLs', () => {
    const options = smtpTransportOptions(config);
    expect(options.secure).toBe(true);
    expect(options.tls?.rejectUnauthorized).not.toBe(false);
    expect(options.tls?.minVersion).toBe('TLSv1.2');
    expect(options.disableFileAccess).toBe(true);
    expect(options.disableUrlAccess).toBe(true);
    expect(options.logger).toBe(false);
    expect(
      smtpTransportOptions({ ...config, port: 587, secure: false }).requireTLS,
    ).toBe(true);
  });

  it('classifies failures into sanitized codes', () => {
    expect(
      classifySmtpError({ responseCode: 451, response: 'texto del servidor' }),
    ).toEqual(new EmailDeliveryError('SMTP_451', true));
    const permanent = classifySmtpError({
      responseCode: 550,
      response: 'user@x unknown',
    });
    expect([permanent.code, permanent.transient]).toEqual(['SMTP_550', false]);
    expect(classifySmtpError({ code: 'ETIMEDOUT' }).transient).toBe(true);
    expect(classifySmtpError({ code: 'EENVELOPE' }).code).toBe(
      'INVALID_RECIPIENT',
    );
    expect(classifySmtpError(new Error('boom')).code).toBe('SMTP_UNKNOWN');
    expect(permanent.message).not.toContain('user@x');
  });

  it('sends through the transport and maps errors without leaking details', async () => {
    const sendMail = jest
      .fn()
      .mockResolvedValue({ messageId: '<id@mentalpieces.site>' });
    const fakeFactory = jest.fn(() => ({
      sendMail,
      verify: jest.fn(),
      close: jest.fn(),
    }));
    const sender = new SmtpEmailSender(
      config,
      fakeFactory as unknown as typeof createTransport,
    );
    const result = await sender.send({
      to: 'a@example.test',
      subject: 's',
      html: '<p>h</p>',
      text: 't',
    });
    expect(result.messageId).toBe('<id@mentalpieces.site>');
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: {
          name: 'Mental Pieces',
          address: 'notificaciones@mentalpieces.site',
        },
        to: 'a@example.test',
      }),
    );
    sendMail.mockRejectedValueOnce({
      responseCode: 421,
      response: 'try later',
    });
    await expect(
      sender.send({ to: 'a@example.test', subject: 's', html: 'h', text: 't' }),
    ).rejects.toEqual(new EmailDeliveryError('SMTP_421', true));
  });
});
