# Mental Pieces — Diagramas de clases

Generados a partir del código (`apps/api/prisma/schema.prisma` y `apps/api/src/`), 2026-10-18.

Convenciones:

- `PK` clave primaria, `FK` clave foránea, `UQ` única, `?` opcional (nullable).
- Multiplicidades en cada extremo: `1`, `0..1`, `0..*`.
- `*--` composición (el hijo no existe sin el padre) · `-->` asociación navegable · `..>` dependencia/uso.

---

## Diagrama 1 · Modelo de dominio

```mermaid
classDiagram
direction TB

%% ========================= Identidad =========================
class User {
  <<entity>>
  +String id PK
  +String email UQ
  -String passwordHash
  +UserRole role
  +Boolean isActive = true
  +DateTime createdAt
  +DateTime updatedAt
}

class Patient {
  <<entity>>
  +String id PK
  +String userId FK UQ
  +String mrn UQ «MP-AAAA-HEX»
  +String? fullName
  +DateTime? birthDate
  +Gender? gender
  +String? genderOther
  +String? phone
  +String? address
  +DateTime createdAt
  +DateTime updatedAt
  +isProfileComplete() Boolean
}

class StaffProfile {
  <<entity>>
  +String id PK
  +String userId FK UQ
  +String fullName
  +String? phone
  +String? position
  +DateTime createdAt
  +DateTime updatedAt
}

%% ========================= Agenda =========================
class PsychologistAvailability {
  <<entity>>
  +String id PK
  +String psychologistId FK
  +WeekDay dayOfWeek
  +Int startMinute  0..1440
  +Int endMinute  0..1440
  +Boolean isActive = true
  +DateTime createdAt
  +DateTime updatedAt
  UQ(psychologistId, dayOfWeek, startMinute, endMinute)
}

class Appointment {
  <<entity>>
  +String id PK
  +String patientId FK
  +String psychologistId FK
  +String appointmentDate  YYYY-MM-DD
  +Int startMinute
  +Int endMinute  = startMinute + 60
  +AppointmentStatus status = SCHEDULED
  +DateTime? cancelledAt
  +String? cancellationReason
  +DateTime createdAt
  +DateTime updatedAt
}

%% ========================= Clínico =========================
class CareRelationship {
  <<entity>>
  +String id PK
  +String patientId FK
  +String psychologistId FK
  +Boolean isActive = true
  +DateTime assignedAt
  +DateTime? endedAt
  +DateTime createdAt
  +DateTime updatedAt
  UQ(patientId, psychologistId)
}

class ClinicalSessionNote {
  <<entity>>
  +String id PK
  +String patientId FK
  +String psychologistId FK
  +String? appointmentId FK UQ
  +Text content  1..10000
  +DateTime createdAt
  +DateTime updatedAt
}

class AuditLog {
  <<entity>>
  +String id PK
  +String actorUserId FK
  +ClinicalAuditAction action
  +String resourceType
  +String resourceId
  +DateTime createdAt
}

%% ========================= Enumeraciones =========================
class UserRole {
  <<enumeration>>
  PATIENT
  STAFF
  ADMIN
  PSYCHOLOGIST
}

class Gender {
  <<enumeration>>
  MALE
  FEMALE
  NON_BINARY
  PREFER_NOT_TO_SAY
  OTHER
}

class WeekDay {
  <<enumeration>>
  MONDAY
  TUESDAY
  WEDNESDAY
  THURSDAY
  FRIDAY
  SATURDAY
  SUNDAY
}

class AppointmentStatus {
  <<enumeration>>
  SCHEDULED
  CANCELLED
  COMPLETED
  NO_SHOW
}

class ClinicalAuditAction {
  <<enumeration>>
  CARE_RELATIONSHIP_CREATED
  CARE_RELATIONSHIP_ENDED
  CLINICAL_NOTE_CREATED
  APPOINTMENT_COMPLETED
  APPOINTMENT_NO_SHOW
}

%% ========================= Relaciones =========================
User "1" *-- "0..1" Patient : perfil de paciente
User "1" *-- "0..1" StaffProfile : perfil interno

User "1" --> "0..*" PsychologistAvailability : publica (PSYCHOLOGIST)
Patient "1" --> "0..*" Appointment : agenda
User "1" --> "0..*" Appointment : atiende citas (PSYCHOLOGIST)

Patient "1" --> "0..*" CareRelationship : es asignado
User "1" --> "0..*" CareRelationship : tiene asignados (PSYCHOLOGIST)

CareRelationship "1" *-- "0..*" ClinicalSessionNote : autoriza (patientId + psychologistId)
User "1" --> "0..*" ClinicalSessionNote : autor (PSYCHOLOGIST)
Appointment "0..1" -- "0..1" ClinicalSessionNote : nota principal (solo COMPLETED)

User "1" --> "0..*" AuditLog : actor
```

### Reglas de negocio del modelo

| Entidad | Regla |
| --- | --- |
| `User` | El `role` define el perfil: PATIENT → `Patient`; STAFF / PSYCHOLOGIST / ADMIN → `StaffProfile`. El registro público siempre crea PATIENT. `passwordHash` nunca sale del API. |
| `Appointment` | Duración 60 min, hora de negocio America/Bogota. SCHEDULED → COMPLETED \| NO_SHOW (psicólogo, cuando terminó); SCHEDULED → CANCELLED (paciente, antes de iniciar). Máx. 4 citas futuras por paciente. No requiere `CareRelationship`. |
| `CareRelationship` | Autoriza el acceso clínico (no el agendamiento). Solo ADMIN la crea o finaliza. Una pareja paciente–psicólogo es única, incluso finalizada. |
| `ClinicalSessionNote` | Requiere `CareRelationship` activa (FK compuesta `patientId + psychologistId`). Cada psicólogo ve solo sus notas. Vinculable a una cita COMPLETED como máximo una vez (`appointmentId` único). Sin edición ni borrado. |
| `AuditLog` | Solo metadatos, nunca contenido clínico. `resourceType + resourceId` es una referencia polimórfica a `CareRelationship`, `ClinicalSessionNote` o `Appointment`. |

---

## Diagrama 2 · Clases del backend (NestJS)

Flujo: **Controller → Service → PrismaService → PostgreSQL**. Los controladores marcados `«JWT + Roles»`
usan `JwtAuthGuard` y `RolesGuard`; la identidad sale siempre de `request.user.sub` (JWT), nunca del body.

```mermaid
classDiagram
direction LR

%% ========================= Seguridad transversal =========================
class JwtAuthGuard {
  <<guard>>
  -JwtService jwtService
  +canActivate(ctx) Promise~boolean~
  -extractToken(req) string
}
class RolesGuard {
  <<guard>>
  -Reflector reflector
  +canActivate(ctx) boolean
}
class ThrottlerGuard {
  <<global guard>>
  RATE_LIMITS por IP
}
class JwtPayload {
  <<interface>>
  +String sub
  +String email
  +UserRole role
}
class LoginAttemptsService {
  <<service>>
  -Map~string, Attempts~ attempts
  +assertNotLocked(email) void
  +recordFailure(email) void
  +recordSuccess(email) void
  -evict(now) void
}

%% ========================= Auth / Usuarios =========================
class AuthController {
  <<controller /auth>>
  +login(LoginDto) POST /login
  +getCurrentUser() GET /me «JWT»
}
class AuthService {
  <<service>>
  +login(LoginDto) accessToken + user
}
class UsersController {
  <<controller /users>>
  +createPatientUser(CreatePatientUserDto) POST
}
class UsersService {
  <<service>>
  +findByEmailForAuth(email) User
  +createPatientUser(dto) User + mrn
  -generateMrn() String
}

%% ========================= Pacientes / Staff =========================
class PatientsController {
  <<controller /patients «JWT + Roles» PATIENT>>
  +getMyProfile() GET /me
  +updateMyProfile(UpdateMyProfileDto) PATCH /me
}
class PatientsService {
  <<service>>
  +getMyProfile(userId) Profile
  +updateMyProfile(userId, dto) Profile
  -isProfileComplete(patient) boolean
}
class StaffController {
  <<controller /staff>>
  +createInternalUser(CreateStaffUserDto) POST «ADMIN»
  +findPsychologists() GET /psychologists «JWT»
}
class StaffService {
  <<service>>
  +createInternalUser(dto) User
  +findActivePsychologists() StaffProfile[]
}

%% ========================= Agenda =========================
class AvailabilityController {
  <<controller /availability «JWT + Roles»>>
  +createMyAvailability(dto) POST /me
  +getMyAvailability() GET /me
  +removeMyAvailability(id) DELETE /me/:id
  +getPsychologistAvailability(id) GET /psychologists/:id
}
class AvailabilityService {
  <<service>>
  +create(psychologistId, dto)
  +getMine(psychologistId)
  +getForPsychologist(psychologistId)
  +remove(psychologistId, availabilityId)
  -validatePsychologist(id)
}
class AppointmentsController {
  <<controller /appointments «JWT + Roles»>>
  +create(CreateAppointmentDto) POST /me
  +getMine() GET /me
  +cancel(id, CancelAppointmentDto) PATCH /me/:id/cancel
  +reschedule(id, RescheduleAppointmentDto) PATCH /me/:id/reschedule
  +getPsychologistAgenda() GET /psychologist/me
  +getAvailableSlots(psychologistId, date) GET /available-slots
}
class AppointmentsService {
  <<service>>
  +MAX_UPCOMING_APPOINTMENTS_PER_PATIENT = 4
  +create(patientUserId, dto)
  +getMine(patientUserId)
  +cancel(patientUserId, id, dto)
  +reschedule(patientUserId, id, dto)
  +getPsychologistAgenda(psychologistUserId)
  +getAvailableSlots(userId, psychologistId, date) string[]
  -assertFutureDateAndTime(date, startMinute)
  -hasAvailability(psychologistId, date, start, end) boolean
}
class AppointmentLifecycleController {
  <<controller /appointments/psychologist/me «JWT + Roles» PSYCHOLOGIST>>
  +complete(id) PATCH /:id/complete
  +noShow(id) PATCH /:id/no-show
}
class AppointmentLifecycleService {
  <<service>>
  +finish(psychologistId, id, COMPLETED|NO_SHOW)
}
class AppointmentTime {
  <<utility>>
  +businessNow(now) BusinessNow
  +isCalendarDate(date) boolean
  +weekDayOf(date) WeekDay
  +hasAppointmentStarted(date, startMinute, now) boolean
  +hasAppointmentEnded(date, endMinute, now) boolean
  +formatAppointmentTime(minutes) string
}

%% ========================= Clínico =========================
class ClinicalController {
  <<controller /clinical «JWT + Roles» PSYCHOLOGIST>>
  +listAlerts(page) GET /alerts
  +listPatients(page) GET /patients
  +listNotes(patientId, page) GET /patients/:id/notes
  +createNote(patientId, CreateClinicalNoteDto) POST /patients/:id/notes
}
class CareRelationshipsController {
  <<controller /clinical/assignments «JWT + Roles» ADMIN>>
  +list(page) GET
  +create(CreateCareRelationshipDto) POST
  +end(id) PATCH /:id/end
}
class ClinicalAdminController {
  <<controller /clinical/admin «JWT + Roles» ADMIN>>
  +listAlerts(page) GET /alerts
  +listPatients(page) GET /patients
}
class ClinicalService {
  <<service>>
  +listPatients(psychologistUserId, page)
  +listNotes(psychologistUserId, patientId, page)
  +createNote(psychologistUserId, patientId, dto)
}
class CareRelationshipsService {
  <<service>>
  +listAssignments(adminId, page)
  +listAssignablePatients(adminId, page)
  +create(adminId, dto)
  +end(adminId, relationshipId)
}
class CareAlertsService {
  <<service>>
  +listForPsychologist(psychologistUserId, page)
  +listForAdmin(adminId, page)
  -activeRelationships(tx, where)
  -build(tx, relationships, page, includePsychologist)
}
class CareAlerts {
  <<utility>>
  +CARE_ALERT_RULES
  +evaluateCareAlert(assignedAt, appointments, now) CareAlertEvaluation?
  +businessDate(instant) string
}
class ClinicalAccessService {
  <<service>>
  +activeRelationshipWhere(psychologistUserId) WhereInput
  +assertPsychologistCanAccessPatient(tx, psychologistUserId, patientId) «404»
  +assertActiveAdmin(tx, actorUserId) «403»
}
class ClinicalTransactionService {
  <<service>>
  +run(operation, duplicateMessage) T
  Serializable + 3 reintentos P2034
}

%% ========================= Persistencia =========================
class PrismaService {
  <<repository>>
  PrismaClient + PrismaPg
  +onModuleInit()
  +onModuleDestroy()
}

%% ========================= Relaciones (uso / inyección) =========================
AuthController --> AuthService
AuthService --> UsersService
AuthService --> LoginAttemptsService
UsersController --> UsersService
PatientsController --> PatientsService
StaffController --> StaffService
AvailabilityController --> AvailabilityService
AppointmentsController --> AppointmentsService
AppointmentLifecycleController --> AppointmentLifecycleService
ClinicalController --> ClinicalService
ClinicalController --> CareAlertsService
CareRelationshipsController --> CareRelationshipsService
ClinicalAdminController --> CareRelationshipsService
ClinicalAdminController --> CareAlertsService

ClinicalService --> ClinicalAccessService
ClinicalService --> ClinicalTransactionService
CareRelationshipsService --> ClinicalAccessService
CareRelationshipsService --> ClinicalTransactionService
CareAlertsService --> ClinicalAccessService
CareAlertsService --> ClinicalTransactionService
CareAlertsService ..> CareAlerts
AppointmentsService ..> AppointmentTime
AppointmentLifecycleService ..> AppointmentTime
CareAlerts ..> AppointmentTime

UsersService --> PrismaService
PatientsService --> PrismaService
StaffService --> PrismaService
AvailabilityService --> PrismaService
AppointmentsService --> PrismaService
AppointmentLifecycleService --> PrismaService
ClinicalTransactionService --> PrismaService

JwtAuthGuard ..> JwtPayload : request.user
RolesGuard ..> JwtPayload : role

note for JwtAuthGuard "Aplicado a todo controlador «JWT».\nToken HS256, 15 min, en Authorization: Bearer."
note for ThrottlerGuard "Global: 120/min por IP.\nlogin 20/15min · registro 5/h ·\ncitas 30/h · alertas 20/min."
note for ClinicalAccessService "Sin CareRelationship activa → 404 genérico\n(no revela si el paciente existe)."
```

### DTOs de entrada (validados por `ValidationPipe` con `whitelist` + `forbidNonWhitelisted`)

| DTO | Campos | Usado por |
| --- | --- | --- |
| `LoginDto` | email, password (8–72) | `AuthController.login` |
| `CreatePatientUserDto` | email, password (8–72) | `UsersController` |
| `CreateStaffUserDto` | email, password, fullName, role (STAFF \| PSYCHOLOGIST), phone?, position? | `StaffController` |
| `UpdateMyProfileDto` | fullName?, birthDate?, gender?, genderOther?, phone? | `PatientsController` |
| `CreateAvailabilityDto` | dayOfWeek, startTime, endTime (HH:mm) | `AvailabilityController` |
| `CreateAppointmentDto` | psychologistId (User.id), appointmentDate, startTime | `AppointmentsController.create` |
| `RescheduleAppointmentDto` | appointmentDate, startTime | `AppointmentsController.reschedule` |
| `CancelAppointmentDto` | reason? (≤300) | `AppointmentsController.cancel` |
| `FinishAppointmentDto` | — (vacío: rechaza cualquier campo) | `AppointmentLifecycleController` |
| `CreateCareRelationshipDto` | patientId, psychologistId (CUID) | `CareRelationshipsController.create` |
| `EndCareRelationshipDto` | — (vacío) | `CareRelationshipsController.end` |
| `CreateClinicalNoteDto` | content (1–10 000), appointmentId? | `ClinicalController.createNote` |
| `ClinicalPageDto` | page (1–10 000) | listados paginados clínicos |
