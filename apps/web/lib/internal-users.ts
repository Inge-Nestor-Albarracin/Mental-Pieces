import { ApiError, type CreateInternalUserPayload, type InternalRole } from './api';

// UX checks only: the API re-validates every field and enforces the ADMIN role.

export const INTERNAL_ROLE_OPTIONS: { value: InternalRole; label: string; description: string }[] = [
  {
    value: 'PSYCHOLOGIST',
    label: 'Psicólogo',
    description: 'Atiende citas, gestiona su disponibilidad y escribe notas de sus pacientes asignados.',
  },
  {
    value: 'STAFF',
    label: 'Staff',
    description: 'Personal de apoyo. Todavía no tiene un portal propio en la aplicación.',
  },
];

export const INTERNAL_ROLE_LABEL: Record<InternalRole, string> = {
  PSYCHOLOGIST: 'Psicólogo',
  STAFF: 'Staff',
};

export interface InternalUserForm {
  role: InternalRole | '';
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  phone: string;
  position: string;
}

export const EMPTY_INTERNAL_USER_FORM: InternalUserForm = {
  role: '',
  fullName: '',
  email: '',
  password: '',
  confirmPassword: '',
  phone: '',
  position: '',
};

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same limits as CreateStaffUserDto.
export function validateInternalUser(form: InternalUserForm): string | null {
  if (!form.role) return 'Elige si la cuenta es de un psicólogo o de staff.';
  const fullName = form.fullName.trim();
  if (fullName.length < 2) return 'Escribe el nombre completo (mínimo 2 caracteres).';
  if (fullName.length > 120) return 'El nombre no puede superar los 120 caracteres.';
  if (!EMAIL_PATTERN.test(form.email.trim())) return 'Escribe un correo electrónico válido.';
  if (form.password.length < 8) return 'La contraseña inicial debe tener al menos 8 caracteres.';
  if (form.password.length > 72) return 'La contraseña no puede superar los 72 caracteres.';
  if (form.password !== form.confirmPassword) return 'Las contraseñas no coinciden.';
  const phone = form.phone.trim();
  if (phone && (phone.length < 7 || phone.length > 25)) return 'El teléfono debe tener entre 7 y 25 caracteres.';
  if (form.position.trim().length > 100) return 'El cargo no puede superar los 100 caracteres.';
  return null;
}

// Optional fields are omitted when empty so the API applies its defaults.
export function toCreatePayload(form: InternalUserForm): CreateInternalUserPayload {
  if (!form.role) throw new Error('Role is required.');
  const phone = form.phone.trim();
  const position = form.position.trim();
  return {
    role: form.role,
    fullName: form.fullName.trim(),
    email: form.email.trim().toLowerCase(),
    password: form.password,
    ...(phone ? { phone } : {}),
    ...(position ? { position } : {}),
  };
}

export function internalUserErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 409) return 'Ya existe una cuenta con ese correo electrónico.';
    if (error.status === 429) return 'Se crearon demasiadas cuentas seguidas. Espera un momento e intenta de nuevo.';
    if (error.status === 400) return error.message;
  }
  return 'No fue posible crear el usuario. Intenta de nuevo.';
}
