BEGIN;

-- CreateEnum
CREATE TYPE "ClinicalAuditAction" AS ENUM ('CARE_RELATIONSHIP_CREATED', 'CARE_RELATIONSHIP_ENDED', 'CLINICAL_NOTE_CREATED');

-- CreateTable
CREATE TABLE "CareRelationship" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CareRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicalSessionNote" (
    "id" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClinicalSessionNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" "ClinicalAuditAction" NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CareRelationship_psychologistId_isActive_patientId_idx" ON "CareRelationship"("psychologistId", "isActive", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "CareRelationship_patientId_psychologistId_key" ON "CareRelationship"("patientId", "psychologistId");

-- CreateIndex
CREATE INDEX "ClinicalSessionNote_psychologistId_patientId_createdAt_id_idx" ON "ClinicalSessionNote"("psychologistId", "patientId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AuditLog_resourceType_resourceId_createdAt_idx" ON "AuditLog"("resourceType", "resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "CareRelationship" ADD CONSTRAINT "CareRelationship_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CareRelationship" ADD CONSTRAINT "CareRelationship_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalSessionNote" ADD CONSTRAINT "ClinicalSessionNote_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalSessionNote" ADD CONSTRAINT "ClinicalSessionNote_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicalSessionNote" ADD CONSTRAINT "ClinicalSessionNote_patientId_psychologistId_fkey" FOREIGN KEY ("patientId", "psychologistId") REFERENCES "CareRelationship"("patientId", "psychologistId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
