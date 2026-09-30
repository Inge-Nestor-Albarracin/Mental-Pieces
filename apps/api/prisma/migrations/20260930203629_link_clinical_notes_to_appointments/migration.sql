/*
  Warnings:

  - A unique constraint covering the columns `[appointmentId]` on the table `ClinicalSessionNote` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ClinicalAuditAction" ADD VALUE 'APPOINTMENT_COMPLETED';
ALTER TYPE "ClinicalAuditAction" ADD VALUE 'APPOINTMENT_NO_SHOW';

-- AlterTable
ALTER TABLE "ClinicalSessionNote" ADD COLUMN     "appointmentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ClinicalSessionNote_appointmentId_key" ON "ClinicalSessionNote"("appointmentId");

-- AddForeignKey
ALTER TABLE "ClinicalSessionNote" ADD CONSTRAINT "ClinicalSessionNote_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
