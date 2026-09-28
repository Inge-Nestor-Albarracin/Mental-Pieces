const API_URL =
  process.env.NEXT_PUBLIC_API_URL ??
  'http://127.0.0.1:3001';

async function parseErrorMessage(
  response: Response,
  fallback: string,
) {
  try {
    const error = await response.json();
    return error.message ?? fallback;
  } catch {
    return fallback;
  }
}

export async function login(
  email: string,
  password: string,
): Promise<{ accessToken: string; user: CurrentUser }> {
  const response = await fetch(`${API_URL}/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible iniciar sesión.',
      ),
    );
  }

  return response.json();
}

export type UserRole = 'PATIENT' | 'PSYCHOLOGIST' | 'ADMIN' | 'STAFF';

export interface CurrentUser {
  id: string;
  email: string;
  role: UserRole;
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

// The caller supplies the existing session token; nothing is persisted here.
async function authenticatedRequest<T>(
  token: string,
  path: string,
  fallback: string,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    cache: 'no-store',
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });

  if (!response.ok) {
    const message: unknown = await parseErrorMessage(response, fallback);
    const detail = typeof message === 'string'
      ? message
      : Array.isArray(message) && message.every((item) => typeof item === 'string')
        ? message.join(' ')
        : fallback;
    throw new ApiError(response.status, response.status >= 500 ? fallback : detail);
  }

  return response.json();
}

export function getCurrentUser(token: string): Promise<CurrentUser> {
  return authenticatedRequest(token, '/auth/me', 'No fue posible verificar tu sesión.');
}

export type WeekDay =
  | 'MONDAY' | 'TUESDAY' | 'WEDNESDAY' | 'THURSDAY'
  | 'FRIDAY' | 'SATURDAY' | 'SUNDAY';

export interface CreateAvailabilityPayload {
  dayOfWeek: WeekDay;
  startTime: string;
  endTime: string;
}

export interface AvailabilityBlock extends CreateAvailabilityPayload {
  id: string;
  isActive: boolean;
}

export interface PsychologistAppointment {
  id: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  status: AppointmentSummary['status'];
  patient: { id: string; fullName: string | null };
}

export function getMyAvailability(token: string): Promise<AvailabilityBlock[]> {
  return authenticatedRequest(token, '/availability/me', 'No fue posible cargar tu disponibilidad.');
}

export function createMyAvailability(
  token: string,
  { dayOfWeek, startTime, endTime }: CreateAvailabilityPayload,
): Promise<AvailabilityBlock> {
  return authenticatedRequest(token, '/availability/me', 'No fue posible agregar el horario.', {
    method: 'POST',
    body: JSON.stringify({ dayOfWeek, startTime, endTime }),
  });
}

export async function deleteMyAvailability(token: string, id: string): Promise<void> {
  await authenticatedRequest<{ message: string }>(
    token,
    `/availability/me/${encodeURIComponent(id)}`,
    'No fue posible eliminar el horario.',
    { method: 'DELETE' },
  );
}

export function getPsychologistAppointments(token: string): Promise<PsychologistAppointment[]> {
  return authenticatedRequest(token, '/appointments/psychologist/me', 'No fue posible cargar tu agenda.');
}

export async function getMyProfile(token: string) {
  const response = await fetch(`${API_URL}/patients/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible consultar el perfil.',
      ),
    );
  }

  return response.json();
}

export async function registerPatient(
  email: string,
  password: string,
) {
  const response = await fetch(`${API_URL}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible crear la cuenta.',
      ),
    );
  }

  return response.json();
}

export interface UpdatePatientProfile {
  fullName?: string;
  birthDate?: string;
  gender?: string;
  genderOther?: string;
  phone?: string;
}

export async function updateMyProfile(
  token: string,
  data: UpdatePatientProfile,
) {
  const response = await fetch(`${API_URL}/patients/me`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible actualizar el perfil.',
      ),
    );
  }

  return response.json();
}

export interface PsychologistOption {
  id: string;
  fullName: string;
  position: string | null;
  user: {
    id: string;
  };
}

export async function getPsychologists(
  token: string,
): Promise<PsychologistOption[]> {
  const response = await fetch(
    `${API_URL}/staff/psychologists`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible cargar los psicólogos.',
      ),
    );
  }

  return response.json();
}

export interface CreateAppointmentPayload {
  psychologistId: string;
  appointmentDate: string;
  startTime: string;
}

export interface AppointmentSummary {
  id: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  psychologist: {
    id: string;
    fullName: string | null;
    position?: string | null;
  };
}

export async function getMyAppointments(
  token: string,
): Promise<AppointmentSummary[]> {
  const response = await fetch(`${API_URL}/appointments/me`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible cargar tus citas.',
      ),
    );
  }

  return response.json();
}

export async function getAvailableSlots(
  token: string,
  psychologistId: string,
  date: string,
): Promise<string[]> {
  const params = new URLSearchParams({
    psychologistId,
    date,
  });

  const response = await fetch(
    `${API_URL}/appointments/available-slots?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible consultar los horarios disponibles.',
      ),
    );
  }

  return response.json();
}

export async function createAppointment(
  token: string,
  payload: CreateAppointmentPayload,
) {
  const response = await fetch(`${API_URL}/appointments/me`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible crear la cita.',
      ),
    );
  }

  return response.json();
}

export async function cancelAppointment(
  token: string,
  appointmentId: string,
  reason?: string,
) {
  const response = await fetch(
    `${API_URL}/appointments/me/${appointmentId}/cancel`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(reason ? { reason } : {}),
    },
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible cancelar la cita.',
      ),
    );
  }

  return response.json();
}

export async function rescheduleAppointment(
  token: string,
  appointmentId: string,
  payload: {
    appointmentDate: string;
    startTime: string;
  },
) {
  const response = await fetch(
    `${API_URL}/appointments/me/${appointmentId}/reschedule`,
    {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    },
  );

  if (!response.ok) {
    throw new Error(
      await parseErrorMessage(
        response,
        'No fue posible reagendar la cita.',
      ),
    );
  }

  return response.json();
}
