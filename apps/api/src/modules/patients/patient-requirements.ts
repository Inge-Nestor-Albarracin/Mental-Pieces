import { ConflictException } from '@nestjs/common';

import { Gender } from '../../../generated/prisma/client';
import type { Prisma } from '../../../generated/prisma/client';
import { businessNow } from '../appointments/appointment-time';
import { hasAcceptedDataPolicy } from '../legal/data-policy';

// What a patient needs before booking online. Pure checks are shared by the
// profile (isProfileComplete) and by booking, which re-reads the row from
// PostgreSQL inside its own transaction: the browser state is never trusted.

export const FULL_NAME_MIN = 2;
export const FULL_NAME_MAX = 120;
export const PHONE_MIN = 7;
export const PHONE_MAX = 25;
export const ADULT_AGE = 18;
const EARLIEST_BIRTH_YEAR = 1900;
const GENDERS = new Set<string>(Object.values(Gender));

export const PROFILE_INCOMPLETE_MESSAGE =
  'Debes completar tu perfil antes de agendar una cita.';
export const DATA_POLICY_REQUIRED_MESSAGE =
  'Debes aceptar la Política de Tratamiento de Datos Personales antes de continuar.';
// Pending decision: there is no representation/authorisation procedure for minors
// yet, so online booking for them is not enabled silently.
export const MINOR_BOOKING_MESSAGE =
  'Por ahora no es posible agendar en línea citas para menores de 18 años. Comunícate con el consultorio.';

export interface ProfileFields {
  fullName: string | null;
  birthDate: Date | null;
  gender: Gender | null;
  genderOther: string | null;
  phone: string | null;
}

export function isValidFullName(value: string | null): boolean {
  const name = value?.trim() ?? '';
  return name.length >= FULL_NAME_MIN && name.length <= FULL_NAME_MAX;
}

// Digits, spaces and the usual separators; at least 7 digits. No SMS is sent.
export function isValidPhone(value: string | null): boolean {
  const phone = value?.trim() ?? '';
  return (
    phone.length >= PHONE_MIN &&
    phone.length <= PHONE_MAX &&
    /^\+?[0-9\s().-]+$/.test(phone) &&
    phone.replace(/\D/g, '').length >= PHONE_MIN
  );
}

// Calendar date (stored at UTC midnight), not in the future (Bogotá), not before 1900.
export function isValidBirthDate(
  value: Date | null,
  today = businessNow().date,
): boolean {
  if (!value || !Number.isFinite(value.getTime())) return false;
  const date = value.toISOString().slice(0, 10);
  return date <= today && value.getUTCFullYear() >= EARLIEST_BIRTH_YEAR;
}

export function isProfileComplete(
  profile: ProfileFields,
  today = businessNow().date,
): boolean {
  return (
    isValidFullName(profile.fullName) &&
    isValidBirthDate(profile.birthDate, today) &&
    profile.gender !== null &&
    GENDERS.has(profile.gender) &&
    (profile.gender !== Gender.OTHER || Boolean(profile.genderOther?.trim())) &&
    isValidPhone(profile.phone)
  );
}

export function isMinor(birthDate: Date, today = businessNow().date): boolean {
  const [year, month, day] = today.split('-').map(Number);
  const adultFrom = new Date(Date.UTC(year - ADULT_AGE, month - 1, day));
  return birthDate.getTime() > adultFrom.getTime();
}

// Booking guard, run inside the booking transaction with the transaction client.
export async function assertPatientCanBook(
  tx: Prisma.TransactionClient,
  patientUserId: string,
): Promise<void> {
  const profile = await tx.patient.findUnique({
    where: { userId: patientUserId },
    select: {
      fullName: true,
      birthDate: true,
      gender: true,
      genderOther: true,
      phone: true,
    },
  });
  if (!profile || !isProfileComplete(profile)) {
    throw new ConflictException(PROFILE_INCOMPLETE_MESSAGE);
  }
  if (!(await hasAcceptedDataPolicy(tx, patientUserId))) {
    throw new ConflictException(DATA_POLICY_REQUIRED_MESSAGE);
  }
  if (isMinor(profile.birthDate!)) {
    throw new ConflictException(MINOR_BOOKING_MESSAGE);
  }
}
