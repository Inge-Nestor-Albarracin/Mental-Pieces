import type { Gender } from './api';

// Pure presentation helpers for the patient profile.

export const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'FEMALE', label: 'Femenino' },
  { value: 'MALE', label: 'Masculino' },
  { value: 'NON_BINARY', label: 'No binario' },
  { value: 'OTHER', label: 'Otro' },
  { value: 'PREFER_NOT_TO_SAY', label: 'Prefiero no especificarlo' },
];

export function genderLabel(gender: Gender | null, genderOther: string | null): string | null {
  if (!gender) return null;
  if (gender === 'OTHER') return genderOther?.trim() || 'Otro';
  return GENDER_OPTIONS.find((option) => option.value === gender)?.label ?? null;
}

// The API returns birthDate as an ISO instant at UTC midnight; it is a calendar date.
export function birthDateInput(birthDate: string | null): string {
  return birthDate ? birthDate.slice(0, 10) : '';
}

// "14 de octubre de 1990", never shifted by the browser timezone.
export function formatBirthDate(birthDate: string | null): string | null {
  const match = birthDate ? /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate) : null;
  if (!match) return null;
  return new Intl.DateTimeFormat('es-CO', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12)));
}

export function firstName(fullName: string | null): string {
  return fullName?.trim().split(/\s+/)[0] || 'paciente';
}
