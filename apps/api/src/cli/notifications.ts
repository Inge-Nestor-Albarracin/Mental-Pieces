// Private command-line entry point for email notifications. Run by Hostinger cron;
// never exposed over HTTP. Compiled to dist/src/cli/notifications.js.
//
//   node dist/src/cli/notifications.js process       send due messages (one bounded run)
//   node dist/src/cli/notifications.js verify-smtp   check SMTP login, sends nothing
//   node dist/src/cli/notifications.js send-test --to <address> --confirm
//                                                    one sample email to NOTIFICATIONS_TEST_RECIPIENT
//
// Configuration comes from the environment (preferably `node --env-file=<private file>`).
// Output never includes passwords, connection strings or full email addresses.
import 'dotenv/config';
import { NotificationType } from '../../generated/prisma/enums';
import { PrismaService } from '../database/prisma.service';
import { EmailDeliveryError } from '../modules/notifications/email/email-sender';
import { renderNotificationEmail } from '../modules/notifications/email/email-templates';
import { SmtpEmailSender } from '../modules/notifications/email/smtp-email-sender';
import { NotificationProcessor } from '../modules/notifications/notification-processor';
import {
  loadNotificationsConfig,
  loadSmtpConfig,
  maskEmail,
  NotificationsConfigError,
} from '../modules/notifications/notifications-config';
import { businessNow } from '../modules/appointments/appointment-time';

const log = (message: string) =>
  console.log(`[notifications] ${new Date().toISOString()} ${message}`);

function argValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function processQueue(): Promise<number> {
  const config = loadNotificationsConfig();
  if (!config.enabled) {
    log('disabled (NOTIFICATIONS_ENABLED=false): nothing sent');
    return 0;
  }
  const sender = new SmtpEmailSender(loadSmtpConfig());
  const prisma = new PrismaService();
  try {
    await prisma.$connect();
    const summary = await new NotificationProcessor(
      prisma,
      sender,
      config,
    ).runOnce();
    log(`run ${JSON.stringify(summary)}`);
    return 0;
  } finally {
    sender.close();
    await prisma.$disconnect();
  }
}

async function verifySmtp(): Promise<number> {
  const smtp = loadSmtpConfig();
  const sender = new SmtpEmailSender(smtp);
  try {
    await sender.verify();
    log(
      `SMTP OK: ${smtp.host}:${smtp.port} (${smtp.secure ? 'TLS' : 'STARTTLS'}), login accepted`,
    );
    return 0;
  } finally {
    sender.close();
  }
}

// Sends ONE sample message, only to the address authorised in NOTIFICATIONS_TEST_RECIPIENT
// and repeated on the command line with --confirm. Independent of NOTIFICATIONS_ENABLED.
async function sendTest(args: string[]): Promise<number> {
  const authorised =
    process.env.NOTIFICATIONS_TEST_RECIPIENT?.trim().toLowerCase();
  const requested = argValue(args, '--to')?.trim().toLowerCase();
  if (
    !authorised ||
    !requested ||
    requested !== authorised ||
    !args.includes('--confirm')
  ) {
    log(
      'send-test refused: set NOTIFICATIONS_TEST_RECIPIENT and repeat the same address with --to <address> --confirm',
    );
    return 2;
  }
  const config = loadNotificationsConfig();
  const sender = new SmtpEmailSender(loadSmtpConfig());
  const [y, m, d] = businessNow().date.split('-').map(Number);
  const tomorrow = new Date(Date.UTC(y, m - 1, d + 1))
    .toISOString()
    .slice(0, 10);
  const email = renderNotificationEmail({
    type: NotificationType.APPOINTMENT_CONFIRMATION,
    appointmentDate: tomorrow,
    startMinute: 9 * 60,
    endMinute: 10 * 60,
    appUrl: config.appUrl,
    test: true,
  });
  try {
    const { messageId } = await sender.send({ to: authorised, ...email });
    log(
      `test email ACCEPTED by SMTP for ${maskEmail(authorised)} (messageId ${messageId ?? 'n/a'}). Check the inbox and spam folder.`,
    );
    return 0;
  } finally {
    sender.close();
  }
}

async function main(args: string[]): Promise<number> {
  const command = args[0] ?? 'process';
  if (command === 'process') return processQueue();
  if (command === 'verify-smtp') return verifySmtp();
  if (command === 'send-test') return sendTest(args.slice(1));
  log(`unknown command "${command}". Use: process | verify-smtp | send-test`);
  return 2;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    // Sanitized: configuration errors list variable names; everything else only a code.
    if (error instanceof NotificationsConfigError) log(error.message);
    else if (error instanceof EmailDeliveryError)
      log(`SMTP error ${error.code}`);
    else
      log(
        `error ${(error as { name?: string })?.name ?? 'Error'} ${(error as { code?: string })?.code ?? ''}`.trim(),
      );
    process.exitCode = 1;
  });
