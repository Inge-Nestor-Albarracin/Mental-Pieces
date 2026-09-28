import { ApiError, type WeekDay } from './api';

export const WEEK_DAYS: { value: WeekDay; label: string }[] = [
  { value: 'MONDAY', label: 'Lunes' },
  { value: 'TUESDAY', label: 'Martes' },
  { value: 'WEDNESDAY', label: 'Miércoles' },
  { value: 'THURSDAY', label: 'Jueves' },
  { value: 'FRIDAY', label: 'Viernes' },
  { value: 'SATURDAY', label: 'Sábado' },
  { value: 'SUNDAY', label: 'Domingo' },
];

export function requireSessionToken(): string {
  const token = sessionStorage.getItem('accessToken');
  if (!token) throw new ApiError(401, 'Sesión requerida.');
  return token;
}

export function portalError(caught: unknown, fallback: string): Error {
  return caught instanceof ApiError ? caught : new Error(fallback);
}

export function isAccessError(error: Error | null): boolean {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}
