-- Email notifications (transactional outbox) and the patient's reminder preference.
-- Additive only: new enums, a new table, and two columns with safe defaults on
-- "Patient" (existing rows get emailRemindersEnabled = false). No data is changed.
-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('APPOINTMENT_CONFIRMATION', 'APPOINTMENT_REMINDER', 'APPOINTMENT_CANCELLATION', 'APPOINTMENT_RESCHEDULE');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'PROCESSING', 'ACCEPTED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Patient" ADD COLUMN     "emailRemindersEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "emailRemindersUpdatedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL DEFAULT 'EMAIL',
    "recipientUserId" TEXT NOT NULL,
    "appointmentId" TEXT NOT NULL,
    "appointmentDate" TEXT NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "scheduledFor" TIMESTAMP(3) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "lockedUntil" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_idempotencyKey_key" ON "Notification"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Notification_status_scheduledFor_idx" ON "Notification"("status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Notification_appointmentId_status_idx" ON "Notification"("appointmentId", "status");

-- CreateIndex
CREATE INDEX "Notification_recipientUserId_acceptedAt_idx" ON "Notification"("recipientUserId", "acceptedAt");

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Security: same lock-down as 20261015120000. The table is reachable only through the
-- NestJS API (owner role); Supabase's Data API roles get no access and RLS has no policies.
ALTER TABLE "Notification" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "Notification" FROM %I', data_api_role);
    END IF;
  END LOOP;
END
$$;
