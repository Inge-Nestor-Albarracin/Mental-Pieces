-- Web Push notifications and booking by staff (reception) on behalf of a patient.
-- Additive only: two enum values, one nullable column on "Appointment" and one new
-- table. No existing row is modified.

-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'STAFF_NEW_BOOKING';

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'PUSH';

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "bookedByUserId" TEXT;

-- CreateTable
CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_bookedByUserId_fkey" FOREIGN KEY ("bookedByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Integrity: the stored keys are base64url values of the sizes the Push API produces.
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_keys_check"
  CHECK ("p256dh" ~ '^[A-Za-z0-9_-]{80,100}={0,2}$' AND "auth" ~ '^[A-Za-z0-9_-]{16,30}={0,2}$');

-- Security: same lock-down as 20261015120000. The table is reachable only through the
-- NestJS API (owner role); Supabase's Data API roles get no access and RLS has no policies.
ALTER TABLE "PushSubscription" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE "PushSubscription" FROM %I', data_api_role);
    END IF;
  END LOOP;
END
$$;
