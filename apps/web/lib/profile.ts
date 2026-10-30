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

export interface ProfileForm {
  fullName: string;
  birthDate: string;
  gender: Gender | '';
  genderOther: string;
  phone: string;
}

// Same rules as the API (which validates again): first problem in reading order,
// or null when the form can be sent.
export function profileFormIssue(form: ProfileForm, today: string): string | null {
  const name = form.fullName.trim();
  if (name.length < 2 || name.length > 120) return 'Escribe tu nombre completo (entre 2 y 120 caracteres).';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(form.birthDate)) return 'Indica tu fecha de nacimiento.';
  if (form.birthDate > today) return 'La fecha de nacimiento no puede estar en el futuro.';
  if (form.birthDate < '1900-01-01') return 'La fecha de nacimiento no es válida.';
  const phone = form.phone.trim();
  if (phone.length < 7 || phone.length > 25 || !/^\+?[0-9\s().-]+$/.test(phone) || phone.replace(/\D/g, '').length < 7) {
    return 'Escribe un teléfono válido (al menos 7 dígitos).';
  }
  if (!form.gender) return 'Selecciona una opción de género.';
  if (form.gender === 'OTHER' && !form.genderOther.trim()) return 'Indica cómo te identificas o elige otra opción.';
  return null;
}

// Under 18 on the business date (both YYYY-MM-DD). Online booking is not enabled
// for minors until a representation procedure exists (the API enforces it).
export function isUnderage(birthDate: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const adultFrom = `${String(Number(today.slice(0, 4)) - 18).padStart(4, '0')}${today.slice(4)}`;
  return birthDate > adultFrom;
}
