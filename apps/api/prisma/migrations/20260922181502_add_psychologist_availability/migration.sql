-- CreateEnum
CREATE TYPE "WeekDay" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "PsychologistAvailability" (
    "id" TEXT NOT NULL,
    "psychologistId" TEXT NOT NULL,
    "dayOfWeek" "WeekDay" NOT NULL,
    "startMinute" INTEGER NOT NULL,
    "endMinute" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PsychologistAvailability_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PsychologistAvailability_psychologistId_dayOfWeek_isActive_idx" ON "PsychologistAvailability"("psychologistId", "dayOfWeek", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "PsychologistAvailability_psychologistId_dayOfWeek_startMinu_key" ON "PsychologistAvailability"("psychologistId", "dayOfWeek", "startMinute", "endMinute");

-- AddForeignKey
ALTER TABLE "PsychologistAvailability" ADD CONSTRAINT "PsychologistAvailability_psychologistId_fkey" FOREIGN KEY ("psychologistId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
