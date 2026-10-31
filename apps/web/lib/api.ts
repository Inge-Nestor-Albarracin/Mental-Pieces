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

export type Gender = 'MALE' | 'FEMALE' | 'NON_BINARY' | 'PREFER_NOT_TO_SAY' | 'OTHER';

export interface PatientProfile {
  id: string;
  mrn: string;
  fullName: string | null;
  birthDate: string | null;
  gender: Gender | null;
  genderOther: string | null;
  phone: string | null;
  isProfileComplete: boolean;
  // Computed by the server: accepted the data policy version currently required.
  dataPolicyAccepted: boolean;
  currentDataPolicyVersion: string | null;
  emailRemindersEnabled: boolean;
}

export interface DataPolicy {
  version: string;
  title: string;
  body: string;
  sha256: string;
  publishedAt: string;
}

// Public: the published Data-Processing Policy. null when none is published yet.
export async function getDataPolicy(): Promise<DataPolicy | null> {
  const response = await fetch(`${API_URL}/legal/data-processing-policy`, { cache: 'no-store' });
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new ApiError(response.status, 'No fue posible cargar la Política de Tratamiento de Datos Personales.');
  }
  return response.json();
}

// Existing accounts accept the current version; the server records version and time.
export function acceptDataPolicy(token: string, dataPolicyVersion: string): Promise<{ dataPolicyAccepted: boolean }> {
  return authenticatedRequest(token, '/patients/me/data-policy-acceptance', 'No fue posible registrar tu autorización.', {
    method: 'POST',
    body: JSON.stringify({ acceptDataPolicy: true, dataPolicyVersion }),
  });
}

export function getMyProfile(token: string): Promise<PatientProfile> {
  return authenticatedRequest(token, '/patients/me', 'No fue posible consultar el perfil.');
}

export async function registerPatient(
  email: string,
  password: string,
  acceptance: { acceptDataPolicy: boolean; dataPolicyVersion: string },
) {
  const response = await fetch(`${API_URL}/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email,
      password,
      acceptDataPolicy: acceptance.acceptDataPolicy,
      dataPolicyVersion: acceptance.dataPolicyVersion,
    }),
  });

  if (!response.ok) {
    const message: unknown = await parseErrorMessage(response, 'No fue posible crear la cuenta.');
    throw new Error(
      Array.isArray(message) ? message.join(' ') : typeof message === 'string' ? message : 'No fue posible crear la cuenta.',
    );
  }

  return response.json();
}

export interface UpdatePatientProfile {
  fullName?: string;
  birthDate?: string;
  gender?: Gender;
  genderOther?: string;
  phone?: string;
}

// Only profile fields travel; identity comes from the JWT on the server.
export function updateMyProfile(
  token: string,
  { fullName, birthDate, gender, genderOther, phone }: UpdatePatientProfile,
): Promise<PatientProfile> {
  return authenticatedRequest(token, '/patients/me', 'No fue posible actualizar el perfil.', {
    method: 'PATCH',
    body: JSON.stringify({ fullName, birthDate, gender, genderOther, phone }),
  });
}

export interface PsychologistOption {
  id: string;
  fullName: string;
  position: string | null;
  user: {
    id: string;
  };
}

// Throws ApiError (an Error) so callers can also distinguish HTTP status.
export function getPsychologists(
  token: string,
): Promise<PsychologistOption[]> {
  return authenticatedRequest(token, '/staff/psychologists', 'No fue posible cargar los psicólogos.');
}

export interface Page<T> {
  items: T[];
  page: number;
  pageSize: number;
  hasMore: boolean;
}

function pageQuery(page: number): string {
  return `?page=${encodeURIComponent(String(page))}`;
}

// --- Clinical (PSYCHOLOGIST). Identity always comes from the JWT on the server. ---

export interface ClinicalPatient {
  id: string;
  fullName: string | null;
}

export interface ClinicalNote {
  id: string;
  content: string;
  appointmentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateClinicalNotePayload {
  content: string;
  appointmentId?: string;
}

export function getClinicalPatients(token: string, page = 1): Promise<Page<ClinicalPatient>> {
  return authenticatedRequest(token, `/clinical/patients${pageQuery(page)}`, 'No fue posible cargar tus pacientes.');
}

export function getClinicalNotes(
  token: string,
  patientId: string,
  page = 1,
): Promise<Page<ClinicalNote>> {
  return authenticatedRequest(
    token,
    `/clinical/patients/${encodeURIComponent(patientId)}/notes${pageQuery(page)}`,
    'No fue posible cargar las notas clínicas.',
  );
}

// patientId belongs only to the URL. The body carries content and, optionally, appointmentId.
export function createClinicalNote(
  token: string,
  patientId: string,
  { content, appointmentId }: CreateClinicalNotePayload,
): Promise<ClinicalNote> {
  return authenticatedRequest(
    token,
    `/clinical/patients/${encodeURIComponent(patientId)}/notes`,
    'No fue posible guardar la nota clínica.',
    {
      method: 'POST',
      body: JSON.stringify(appointmentId ? { content, appointmentId } : { content }),
    },
  );
}

// --- Operational care alerts. Appointment metadata only, never notes. ---

export type CareAlertReason =
  | 'NO_SHOW_STREAK'
  | 'INACTIVE'
  | 'NO_FIRST_SESSION'
  | 'NO_SHOW_WITHOUT_FOLLOW_UP';

export interface CareAlert {
  relationshipId: string;
  patient: { id: string; fullName: string | null };
  psychologist?: { id: string; fullName: string | null };
  level: 'HIGH' | 'MEDIUM';
  reasons: CareAlertReason[];
  lastSessionDate: string | null;
  daysSinceLastSession: number | null;
  daysSinceAssigned: number;
  noShowsSinceLastSession: number;
  nextAppointmentDate: string | null;
}

export interface CareAlertRules {
  noFirstSessionDays: number;
  inactiveDays: number;
  highSeverityDays: number;
  noShowStreak: number;
}

export interface CareAlertPage extends Page<CareAlert> {
  total: number;
  truncated: boolean;
  rules: CareAlertRules;
  generatedAt: string;
}

export function getMyCareAlerts(token: string, page = 1): Promise<CareAlertPage> {
  return authenticatedRequest(token, `/clinical/alerts${pageQuery(page)}`, 'No fue posible cargar las alertas.');
}

export function getAdminCareAlerts(token: string, page = 1): Promise<CareAlertPage> {
  return authenticatedRequest(token, `/clinical/admin/alerts${pageQuery(page)}`, 'No fue posible cargar las alertas.');
}

// --- Clinical assignments (ADMIN). Administrative data only, never notes. ---

export interface AssignablePatient {
  id: string;
  fullName: string | null;
  mrn: string;
}

export interface CareAssignment {
  id: string;
  isActive: boolean;
  assignedAt: string;
  endedAt: string | null;
  patient: { id: string; fullName: string | null };
  psychologist: { id: string; fullName: string | null };
}

export interface CreateCareAssignmentPayload {
  patientId: string;
  psychologistId: string;
}

export function getAssignablePatients(token: string, page = 1): Promise<Page<AssignablePatient>> {
  return authenticatedRequest(token, `/clinical/admin/patients${pageQuery(page)}`, 'No fue posible cargar los pacientes.');
}

export function getCareAssignments(token: string, page = 1): Promise<Page<CareAssignment>> {
  return authenticatedRequest(token, `/clinical/assignments${pageQuery(page)}`, 'No fue posible cargar las asignaciones.');
}

export async function createCareAssignment(
  token: string,
  { patientId, psychologistId }: CreateCareAssignmentPayload,
): Promise<void> {
  await authenticatedRequest<unknown>(token, '/clinical/assignments', 'No fue posible crear la asignación.', {
    method: 'POST',
    body: JSON.stringify({ patientId, psychologistId }),
  });
}

export async function endCareAssignment(token: string, id: string): Promise<void> {
  await authenticatedRequest<unknown>(
    token,
    `/clinical/assignments/${encodeURIComponent(id)}/end`,
    'No fue posible finalizar la asignación.',
    { method: 'PATCH' },
  );
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

// Appointment calls go through authenticatedRequest so the UI can tell 400/401/403/404/409 apart.

export function getMyAppointments(token: string): Promise<AppointmentSummary[]> {
  return authenticatedRequest(token, '/appointments/me', 'No fue posible cargar tus citas.');
}

// psychologistId is the psychologist's User id (PsychologistOption.user.id), never StaffProfile.id.
export function getAvailableSlots(
  token: string,
  psychologistId: string,
  date: string,
): Promise<string[]> {
  const params = new URLSearchParams({ psychologistId, date });
  return authenticatedRequest(
    token,
    `/appointments/available-slots?${params.toString()}`,
    'No fue posible consultar los horarios disponibles.',
  );
}

export function createAppointment(
  token: string,
  { psychologistId, appointmentDate, startTime }: CreateAppointmentPayload,
): Promise<AppointmentSummary> {
  return authenticatedRequest(token, '/appointments/me', 'No fue posible crear la cita.', {
    method: 'POST',
    body: JSON.stringify({ psychologistId, appointmentDate, startTime }),
  });
}

export async function cancelAppointment(
  token: string,
  appointmentId: string,
  reason?: string,
): Promise<void> {
  await authenticatedRequest<unknown>(
    token,
    `/appointments/me/${encodeURIComponent(appointmentId)}/cancel`,
    'No fue posible cancelar la cita.',
    { method: 'PATCH', body: JSON.stringify(reason ? { reason } : {}) },
  );
}

export async function rescheduleAppointment(
  token: string,
  appointmentId: string,
  { appointmentDate, startTime }: { appointmentDate: string; startTime: string },
): Promise<void> {
  await authenticatedRequest<unknown>(
    token,
    `/appointments/me/${encodeURIComponent(appointmentId)}/reschedule`,
    'No fue posible reagendar la cita.',
    { method: 'PATCH', body: JSON.stringify({ appointmentDate, startTime }) },
  );
}

export async function completePsychologistAppointment(token: string, id: string): Promise<void> {
  await authenticatedRequest<unknown>(
    token,
    `/appointments/psychologist/me/${encodeURIComponent(id)}/complete`,
    'No fue posible marcar la cita como realizada.',
    { method: 'PATCH' },
  );
}

export async function markPsychologistAppointmentNoShow(token: string, id: string): Promise<void> {
  await authenticatedRequest<unknown>(
    token,
    `/appointments/psychologist/me/${encodeURIComponent(id)}/no-show`,
    'No fue posible marcar la inasistencia.',
    { method: 'PATCH' },
  );
}

export interface PsychologistWeeklyAvailability {
  psychologist: { id: string; fullName: string | null; position: string | null };
  availability: { id: string; dayOfWeek: WeekDay; startTime: string; endTime: string; isActive: boolean }[];
}

// Weekly blocks of a psychologist (User id). Used to explain which days have slots.
export function getPsychologistWeeklyAvailability(
  token: string,
  psychologistUserId: string,
): Promise<PsychologistWeeklyAvailability> {
  return authenticatedRequest(
    token,
    `/availability/psychologists/${encodeURIComponent(psychologistUserId)}`,
    'No fue posible consultar la disponibilidad del psicólogo.',
  );
}

// --- Internal users (ADMIN). Psychologist and staff accounts are created only here. ---

export type InternalRole = 'PSYCHOLOGIST' | 'STAFF';

export interface InternalUser {
  id: string;
  email: string;
  role: InternalRole;
  isActive: boolean;
  createdAt: string;
  fullName: string | null;
  phone: string | null;
  position: string | null;
}

export interface CreateInternalUserPayload {
  role: InternalRole;
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  position?: string;
}

export function getInternalUsers(token: string, page = 1): Promise<Page<InternalUser>> {
  return authenticatedRequest(token, `/staff${pageQuery(page)}`, 'No fue posible cargar los usuarios internos.');
}

export function createInternalUser(
  token: string,
  { role, fullName, email, password, phone, position }: CreateInternalUserPayload,
): Promise<InternalUser> {
  return authenticatedRequest(token, '/staff', 'No fue posible crear el usuario.', {
    method: 'POST',
    body: JSON.stringify({ role, fullName, email, password, phone, position }),
  });
}

// Optional 24 h email reminders; the server records when the patient changed it.
export function updateEmailReminders(
  token: string,
  emailReminders: boolean,
): Promise<{ emailReminders: boolean; updatedAt: string | null }> {
  return authenticatedRequest(token, '/patients/me/notification-preferences', 'No fue posible guardar tu preferencia.', {
    method: 'PATCH',
    body: JSON.stringify({ emailReminders }),
  });
}

// ---- Web Push (every role) ----

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
}

export interface PushSubscriptionPayload {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export function getPushConfig(token: string): Promise<PushConfig> {
  return authenticatedRequest(token, '/push/config', 'No fue posible consultar las notificaciones.');
}

export function savePushSubscription(token: string, subscription: PushSubscriptionPayload): Promise<{ subscribed: boolean }> {
  return authenticatedRequest(token, '/push/subscriptions', 'No fue posible activar las notificaciones.', {
    method: 'POST',
    body: JSON.stringify(subscription),
  });
}

export function removePushSubscription(token: string, endpoint: string): Promise<{ subscribed: boolean }> {
  return authenticatedRequest(token, '/push/subscriptions', 'No fue posible desactivar las notificaciones.', {
    method: 'DELETE',
    body: JSON.stringify({ endpoint }),
  });
}

export function sendTestPush(token: string): Promise<{ devices: number; delivered: number }> {
  return authenticatedRequest(token, '/push/test', 'No fue posible enviar la notificación de prueba.', { method: 'POST' });
}

// ---- Reception desk (STAFF) ----

export type BookingBlocker = 'PROFILE_INCOMPLETE' | 'DATA_POLICY' | 'MINOR';

export interface DeskPatient {
  id: string;
  mrn: string;
  fullName: string | null;
  email: string;
  phone: string | null;
  canBook: boolean;
  blockers: BookingBlocker[];
}

export interface DeskAppointment {
  id: string;
  appointmentDate: string;
  startTime: string;
  endTime: string;
  bookedByStaff: boolean;
  patient: { id: string; fullName: string | null; mrn: string };
}

export interface DeskAgenda {
  from: string;
  until: string;
  psychologists: {
    psychologist: { id: string; fullName: string | null; position: string | null };
    appointments: DeskAppointment[];
  }[];
}

export interface DeskBookingPayload extends CreateAppointmentPayload {
  patientId: string;
}

export function searchDeskPatients(token: string, search: string): Promise<{ items: DeskPatient[]; hasMore: boolean }> {
  const params = new URLSearchParams({ search });
  return authenticatedRequest(token, `/staff-desk/patients?${params.toString()}`, 'No fue posible buscar pacientes.');
}

export function getDeskAgenda(token: string, days = 14, psychologistId?: string): Promise<DeskAgenda> {
  const params = new URLSearchParams({ days: String(days) });
  if (psychologistId) params.set('psychologistId', psychologistId);
  return authenticatedRequest(token, `/staff-desk/agenda?${params.toString()}`, 'No fue posible cargar la agenda.');
}

export function createDeskAppointment(token: string, payload: DeskBookingPayload): Promise<AppointmentSummary> {
  return authenticatedRequest(token, '/staff-desk/appointments', 'No fue posible crear la cita.', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
