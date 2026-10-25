# Mental Pieces — Auditoría de seguridad, concurrencia y rendimiento

Fecha: 2026-10-25 · Rama: `main` · Commit base: `fb96975` · Autor: auditoría asistida (Claude)

Este documento sigue el formato pedido: **1) Inspección de Software (Validación y Verificación)**,
**2) Pruebas de Usabilidad – Resultados** y **3) Modificaciones Realizadas**. Dentro de cada parte se
incluyen las secciones exigidas por el prompt de auditoría.

**Niveles de evidencia usados en todo el informe**

| Nivel | Qué significa aquí |
| --- | --- |
| U | Test unitario puro. |
| H | Test HTTP con Nest real (JWT, guards, validación) y Prisma **simulado**. No prueba transacciones reales. |
| I | HTTP o servicio contra **PostgreSQL 18.6 local y desechable** con las 7 migraciones reales aplicadas. |
| P | Carga controlada sobre la API local (portátil) contra esa base local. **No** es Hostinger ni Supabase. |

---

# 1. Inspección de Software (Validación y Verificación)

## 1.1 Alcance y condiciones de seguridad

**Probado:** autorización por objeto (BOLA/IDOR) en citas, agenda, disponibilidad, notas y relaciones
clínicas; carreras reales de reservas en PostgreSQL; secretos en código, historial Git y build; RLS de
Supabase (solo catálogo); JWT, CORS, CSP, límites de peticiones y `TRUST_PROXY`; carga de solo lectura en
local; usabilidad por inspección experta en el navegador.

**No probado (y por qué):**

- Carga contra Supabase o Hostinger: prohibido sin autorización expresa. No se ejecutó.
- Pruebas con varias instancias de la API: hay una sola instancia local.
- Pruebas de usabilidad con usuarios reales: no hay participantes. Se entrega el protocolo (§2.6).
- Producción/staging publicados: no existen todavía; no se revisaron rutas públicas desplegadas.

**Salvaguardas aplicadas:**

- Ningún commit, push, merge, reset ni cambio de historial.
- Cero escrituras en Supabase. La única conexión a Supabase fue una lectura del catálogo (§1.9).
- Base de pruebas: clúster nuevo de PostgreSQL 18.6 creado con los binarios ya instalados, en una carpeta
  temporal de la sesión, puerto `55432`, escuchando solo en `127.0.0.1`, base `mental_pieces_test`. El
  servicio PostgreSQL del equipo (puerto 5432) no se tocó.
- Las pruebas de integración se niegan a correr si la URL no es local o si el nombre de la base no
  contiene `test` (`apps/api/test/integration/setup-isolated-database.ts`), y nunca leen `DATABASE_URL`.
- Datos 100 % sintéticos con correos `@example.test`. Ninguna nota, contraseña, token o cadena de conexión
  real aparece en este informe ni en los resultados guardados.
- Puertos usados solo por la auditoría: 55432 (PostgreSQL), 3941 (API de carga), 3942 y 3943 (web y
  API de usabilidad). El 3001 y el 3000 no se usaron, y todos esos procesos se detuvieron al terminar.

## 1.2 Estado inicial

| Elemento | Valor |
| --- | --- |
| Rama / HEAD | `main` / `fb96975 Diagrams UML` (20 commits en total) |
| Working tree al empezar | Cambios **sin commit** del módulo «Usuarios internos» (pedido anterior en esta misma sesión): `apps/api/src/modules/staff/*`, `rate-limits.ts`, `apps/web/app/admin/users/`, `lib/internal-users.ts`, tests. Se conservaron intactos. |
| Node / pnpm / npm | v24.11.0 / 11.4.0 / 11.6.1 |
| API | NestJS 11.2.7, Prisma 7.10.0 (`@prisma/adapter-pg`), @nestjs/throttler 6.7.1, helmet 8.3.0 |
| Web | Next.js 16.3.8, React 19.2.4 |
| Base de pruebas | PostgreSQL 18.6 local desechable (ver §1.1) |
| Base real | Supabase (PostgreSQL remoto). Solo lectura de catálogo. |
| Herramientas | `rg` y `git` sí; **no** hay Docker, k6, gitleaks ni trufflehog → escáner de secretos y generador de carga propios, offline (§1.8, §1.11). |
| Aislamiento de Jest existente | `test/jest-e2e.json` redirige `prisma.service`, `pg` y `@prisma/adapter-pg` a `test/support/database-blocked.ts`, que lanza un error si algo intenta conectarse. Se mantuvo. |

## 1.3 Mapa real de endpoints y roles

Derivado de los controladores. «JWT» = `JwtAuthGuard`; los roles se aplican con `RolesGuard`.
La identidad siempre sale de `request.user.sub`; ningún endpoint `/me` acepta IDs de identidad.

| Método | Ruta | Roles | Regla de propiedad / notas | Evidencia |
| --- | --- | --- | --- | --- |
| POST | `/auth/login` | público | límite 20/15 min por IP + bloqueo por cuenta (5 fallos → 15 min) | H, I (S2) |
| GET | `/auth/me` | JWT | datos del token | H |
| POST | `/users` | público | siempre crea PATIENT; 5/h por IP | H |
| GET / PATCH | `/patients/me` | PATIENT | perfil del `sub` | H, I (A9) |
| POST | `/staff` | ADMIN (activo en BD) | crea PSYCHOLOGIST/STAFF; 30/h | H |
| GET | `/staff` | ADMIN (activo en BD) | lista internos, sin `passwordHash` | H, I (A7d) |
| GET | `/staff/psychologists` | JWT | psicólogos activos (id, nombre, cargo) | H |
| POST / GET | `/availability/me` | PSYCHOLOGIST | bloques del `sub` | H |
| DELETE | `/availability/me/:id` | PSYCHOLOGIST | solo bloques propios (404 si ajeno) | I (G7) |
| GET | `/availability/psychologists/:id` | PATIENT, PSYCHOLOGIST, STAFF, ADMIN | horario público del psicólogo | H |
| POST | `/appointments/me` | PATIENT | paciente del `sub`; 30/h | H, I (A5a, G6, R1–R3) |
| GET | `/appointments/me` | PATIENT | solo citas del paciente | I (A1, A2) |
| PATCH | `/appointments/me/:id/cancel` | PATIENT | cita propia, SCHEDULED y no iniciada | I (A3, A5b, G5) |
| PATCH | `/appointments/me/:id/reschedule` | PATIENT | cita propia, SCHEDULED y no iniciada | I (A4) |
| GET | `/appointments/available-slots` | PATIENT, PSYCHOLOGIST | foto informativa; la reserva revalida | H, I (A7f) |
| GET | `/appointments/psychologist/me` | PSYCHOLOGIST (activo en BD) | agenda propia | I (A8a) |
| PATCH | `/appointments/psychologist/me/:id/complete` y `/no-show` | PSYCHOLOGIST | cita propia, SCHEDULED y ya terminada; auditoría | I (G1–G4) |
| GET | `/clinical/patients` | PSYCHOLOGIST | solo relaciones activas | I (C1, C2, A10) |
| GET / POST | `/clinical/patients/:patientId/notes` | PSYCHOLOGIST | relación activa + autor = `sub`; 404 genérico | I (C3–C11, C14) |
| GET | `/clinical/alerts` | PSYCHOLOGIST | relaciones propias; 20/min | H |
| GET / POST | `/clinical/assignments` | ADMIN (activo en BD) | sin contenido clínico | H, I (A7c) |
| PATCH | `/clinical/assignments/:id/end` | ADMIN (activo en BD) | revoca el acceso del psicólogo | I (C8) |
| GET | `/clinical/admin/patients` | ADMIN (activo en BD) | id, nombre, MRN | H, I (A7e) |
| GET | `/clinical/admin/alerts` | ADMIN (activo en BD) | sin notas; 20/min | H |
| GET | `/` | público | «hello» por defecto de Nest | H |

Rutas nuevas respecto al prompt: `POST /staff`, `GET /staff` (módulo de usuarios internos) y `GET /`.

## 1.4 Matriz BOLA/IDOR

Archivo: `apps/api/test/integration/security-authorization.integration-spec.ts`. Nivel **I**: app Nest
completa (`AppModule` con JWT, `RolesGuard`, `ThrottlerGuard` y `ValidationPipe`) contra PostgreSQL de
prueba. Después de cada intento de escritura se vuelve a leer la fila en la base.

Identidades sintéticas: Paciente A, B, C y un paciente inactivo; Psicólogo X (asignado a A y C),
Psicólogo Y (relación con A **finalizada**, con una nota antigua) y un psicólogo inactivo; un Admin y un
Staff.

| ID | Endpoint | Rol | Operación | HTTP esperado | HTTP observado | Estado persistido | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A1 | GET /appointments/me | PATIENT A | listar propias | 200 | 200 | solo citas de A | PASS |
| A2 | GET /appointments/me?patientId=A | PATIENT B | filtro con ID ajeno | 200 | 200 | solo citas de B | PASS |
| A3 | PATCH /appointments/me/:id/cancel | PATIENT B | cancelar cita de A | 404 | 404 | cita A intacta | PASS |
| A4 | PATCH /appointments/me/:id/reschedule | PATIENT B | reagendar cita de A | 404 | 404 | cita A intacta | PASS |
| A5a | POST /appointments/me | PATIENT B | `patientId`, `status`, `endMinute` en body | 400 | 400 | sin filas nuevas | PASS |
| A5b | PATCH /appointments/me/:id/cancel | PATIENT B | `status` en body | 400 | 400 | cita intacta | PASS |
| A9 | PATCH /patients/me | PATIENT B | `userId` ajeno en body | 400 | 400 | — | PASS |
| A6a–e | GET /appointments/me | — | sin token, corrupto, vencido, otra clave, rol adulterado a ADMIN | 401 | 401 (×5) | sin datos | PASS |
| A7a–g | varios | rol incorrecto | PATIENT→clínico, PSYCHOLOGIST→reservar, STAFF→asignaciones/usuarios/perfil, PATIENT→admin, ADMIN→horarios | 403 | 403 (×7) | — | PASS |
| A8a | GET /appointments/psychologist/me | psicólogo inactivo | JWT previo | 403 | 403 | — | PASS |
| A8b | GET /clinical/patients/:id/notes | psicólogo inactivo con relación activa | JWT previo | 404 | 404 | — | PASS |
| **A8c** | GET /appointments/me | **paciente inactivo** | JWT previo (≤ 15 min) | 401 | **200** | — | **FAIL** → MP-SEC-001 |
| A10a–b | GET /clinical/patients | PSYCHOLOGIST X | `psychologistId` en query, `page=0` | 400 | 400 | — | PASS |
| C1 | GET /clinical/patients | PSYCHOLOGIST X | listar asignados | 200 | 200 | incluye A, no B | PASS |
| C2 | GET /clinical/patients | PSYCHOLOGIST Y | listar asignados | 200 | 200 | no incluye A | PASS |
| C3 | GET …/notes | PSYCHOLOGIST Y | leer notas de A | 404 | 404 | sin contenido | PASS |
| C14 | GET …/notes | PSYCHOLOGIST Y | paciente inexistente | 404 | 404 | **mismo cuerpo que C3** (sin enumeración) | PASS |
| C4 | POST …/notes | PSYCHOLOGIST Y | crear nota para A | 404 | 404 | cero notas nuevas | PASS |
| C5 | GET …/notes | PSYCHOLOGIST X | leer notas de A | 200 | 200 | solo notas de X (no la de Y); `no-store` | PASS |
| C6a–c | GET y POST …/notes | PATIENT, STAFF, ADMIN | leer / crear notas | 403 | 403 (×6) | — | PASS |
| C9a–c | POST …/notes | PSYCHOLOGIST X | vincular cita SCHEDULED, NO_SHOW o de otro paciente | 400 / 400 / 404 | igual | sin nota | PASS |
| C11 | POST …/notes | PSYCHOLOGIST X | `psychologistId`/`authorId` en body | 400 | 400 | sin nota | PASS |
| C9d | POST …/notes | PSYCHOLOGIST X | vincular cita COMPLETED propia | 201 | 201 | 1 nota | PASS |
| C10 | POST …/notes | PSYCHOLOGIST X | segunda nota para la misma cita | 409 | 409 | sigue 1 nota | PASS |
| C16 | AuditLog | sistema | ¿la auditoría guarda contenido? | no | no | solo metadatos | PASS |
| C8a–b | PATCH /clinical/assignments/:id/end, luego GET …/notes | ADMIN, luego X | revocar y volver a leer | 200, 404 | 200, 404 | relación inactiva | PASS |
| G1 | PATCH …/psychologist/me/:id/complete | PSYCHOLOGIST Y | cerrar cita de X | 404 | 404 | sigue SCHEDULED | PASS |
| G2a–c | PATCH …/no-show | PATIENT, STAFF, ADMIN | cerrar como profesional | 403 | 403 (×3) | sigue SCHEDULED | PASS |
| G3 | PATCH …/complete | PSYCHOLOGIST X | cerrar cita futura | 400 | 400 | sigue SCHEDULED | PASS |
| G4 | PATCH …/complete | PSYCHOLOGIST X | cerrar cita pasada propia | 200 | 200 | COMPLETED; otra cita pasada sigue SCHEDULED (no hay cierre automático) | PASS |
| G5 | PATCH /appointments/me/:id/cancel | PATIENT A | cancelar cita ya iniciada | 400 | 400 | sigue SCHEDULED | PASS |
| G6 | POST /appointments/me | PATIENT B sin relación clínica | agendar | 201 | 201 | 1 cita (no exige CareRelationship) | PASS |
| G7 | DELETE /availability/me/:id | PSYCHOLOGIST Y | borrar bloque de X | 404 | 404 | bloque intacto | PASS |
| R1–R3 | 2× POST /appointments/me simultáneos | 2 pacientes | mismo horario | 201 + 409 | 201 + 409 (×3) | 1 fila cada vez | PASS |
| S1 | 52 cuerpos de respuesta | todos | ¿`passwordHash` o notas ajenas? | no | no | — | PASS |
| S2 | POST /auth/login ×21 | anónimo | rotando `X-Forwarded-For` | 429 | 429 | — | PASS |

**Total: 59 casos, 58 PASS, 1 FAIL (A8c, riesgo conocido ya documentado en `docs/security.md`).**
Resultado bruto: `authorization-matrix.json` (carpeta temporal de la auditoría; no versionado).

Las suites H existentes cubren además el rechazo de `alg: none` y HS512, el bloqueo de cuenta, la no
enumeración en el login y la paginación del panel administrativo (`apps/api/test/*.e2e-spec.ts`).

## 1.5 Hallazgos BOLA/IDOR

No se encontró ningún BOLA/IDOR: ningún rol leyó ni modificó recursos de otro usuario conociendo sus
identificadores, y ADMIN/STAFF no obtienen notas clínicas. El único FAIL es de **revocación de sesión**:

```text
ID: MP-SEC-001
Severidad: MEDIO
Estado: CONFIRMADO
Área: Autenticación / revocación
Precondición: un paciente con JWT válido es desactivado (isActive=false).
Pasos mínimos reproducibles con datos sintéticos: firmar JWT de un paciente sintético inactivo y llamar GET /appointments/me.
Resultado esperado: 401/403 inmediato.
Resultado observado: 200 hasta que vence el token (máx. 15 min). Mismo caso en POST /appointments/me, cancel/reschedule y /patients/me.
Evidencia: security-authorization.integration-spec.ts, caso A8c.
Riesgo de negocio: una cuenta suspendida puede seguir agendando o cancelando durante 15 minutos. Las rutas clínicas, de agenda del psicólogo y de administración ya verifican isActive en la base (A8a, A8b).
Corrección recomendada: verificar isActive en JwtAuthGuard (con caché corta) o bajar la vida del token; requiere decidir el costo de una consulta por petición.
¿Requiere aprobación?: sí (cambio de Auth).
```

## 1.6 Concurrencia

**Método.** `apps/api/test/integration/appointments-concurrency.integration-spec.ts` usa los servicios
reales (`AppointmentsService`, `AppointmentLifecycleService`, `ClinicalService`) con Prisma y
transacciones **reales** contra PostgreSQL de prueba. Las dos operaciones de cada carrera se lanzan en el
mismo tick (`Promise.all` sin `await` intermedio), así que ambas leen el horario libre antes de escribir.
Tras cada carrera se **cuentan las filas en la base**. Se añadieron 3 carreras HTTP completas (R1–R3 de
§1.4) que pasan por JWT, guards y el limitador sin desactivarlo.

**Antes de la corrección** (código del commit `fb96975`):

| Carrera | N | Éxitos | 409 | 400/403/404 | 500 | Duplicados en BD | p95 | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mismo psicólogo y horario (2 pacientes) | 20 | 39 | 1 | 0 | 0 | **19** | 10 ms | **FAIL** |
| Intervalos superpuestos 09:00 vs 09:30 | 5 | 10 | 0 | 0 | 0 | **5** | 6 ms | **FAIL** |
| Un paciente, dos psicólogos, misma hora | 5 | 10 | 0 | 0 | 0 | **5** | 13 ms | **FAIL** |
| Reagendar vs agendar al mismo horario | 5 | 10 | 0 | 0 | 0 | **5** | 10 ms | **FAIL** |
| Dos reagendamientos de la misma cita | 5 | 5 | 0 | 5 | 0 | 0 | 83 ms | PASS |
| Cancelar vs reagendar la misma cita | 5 | 5 | 0 | 5 | 0 | 0 | 6 ms | PASS |
| Realizada vs inasistencia | 5 | 5 | 0 | 5 | 0 | 0 | 16 ms | PASS |
| Dos notas para la misma cita | 5 | 5 | 5 | 0 | 0 | 0 | 12 ms | PASS |
| Límite de 4 citas futuras en carrera | 5 | 10 | 0 | 0 | 0 | **5 (quedaron 5 citas)** | 6 ms | **FAIL** |

**Después de la corrección** (§3.1):

| Carrera | N | Éxitos | 409 | 400/403/404 | 500 | Duplicados en BD | p95 | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Mismo psicólogo y horario (2 pacientes) | 20 | 20 | 20 | 0 | 0 | 0 | 38 ms | PASS |
| Intervalos superpuestos 09:00 vs 09:30 | 5 | 5 | 5 | 0 | 0 | 0 | 9 ms | PASS |
| Un paciente, dos psicólogos, misma hora | 5 | 5 | 5 | 0 | 0 | 0 | 19 ms | PASS |
| Reagendar vs agendar al mismo horario | 5 | 5 | 5 | 0 | 0 | 0 | 14 ms | PASS |
| Dos reagendamientos de la misma cita | 5 | 5 | 0 | 5 | 0 | 0 | 11 ms | PASS |
| Cancelar vs reagendar la misma cita | 5 | 5 | 0 | 5 | 0 | 0 | 6 ms | PASS |
| Realizada vs inasistencia | 5 | 5 | 0 | 5 | 0 | 0 | 17 ms | PASS |
| Dos notas para la misma cita | 5 | 5 | 5 | 0 | 0 | 0 | 16 ms | PASS |
| Límite de 4 citas futuras en carrera | 5 | 5 | 5 | 0 | 0 | 0 | 8 ms | PASS |
| HTTP completo (R1–R3, §1.4) | 3 | 3 | 3 | 0 | 0 | 0 | — | PASS |

«Éxitos» cuenta respuestas individuales (2 por carrera). En las carreras que ya pasaban, la segunda
operación recibe 400 porque la actualización condicional (`where` con estado y hora leídos) no encuentra
la fila: no hay pérdida silenciosa de actualizaciones.

```text
ID: MP-CONC-001
Severidad: CRÍTICO
Estado: RESUELTO en código (verificado en Nivel I); pendiente desplegar
Área: Reservas (AppointmentsService.create y reschedule)
Precondición: dos peticiones simultáneas por el mismo horario libre.
Pasos mínimos reproducibles con datos sintéticos: psicólogo sintético con disponibilidad; dos pacientes sintéticos llaman create() con el mismo psychologistId, fecha futura y hora en el mismo tick.
Resultado esperado: una cita SCHEDULED y un 409.
Resultado observado: dos citas SCHEDULED en 19 de 20 carreras; también con solapes parciales, con un mismo paciente en dos psicólogos, reagendar contra agendar y el límite de 4 citas.
Evidencia: appointments-concurrency.integration-spec.ts (tablas de arriba).
Riesgo de negocio: dos pacientes citados a la misma hora con el mismo psicólogo; el límite anti-abuso se puede saltar.
Causa: la transacción usaba READ COMMITTED; «comprobar que está libre» y «crear» no eran atómicos y no hay restricción en la base.
Corrección aplicada: transacción SERIALIZABLE con reintento (3 intentos) → 409 «Ese horario acaba de ser reservado». Sin cambios de esquema ni de reglas de negocio.
¿Requiere aprobación?: la corrección de código no (no cambia reglas, BD ni Auth); el refuerzo en la base (MP-CONC-004) sí.
```

```text
ID: MP-CONC-002
Severidad: MEDIO
Estado: POTENCIAL
Área: ClinicalTransactionService y AppointmentLifecycleService
Hallazgo: con @prisma/adapter-pg, un conflicto de serialización de PostgreSQL (SQLSTATE 40001) llega a veces como DriverAdapterError «TransactionWriteConflict» y no como P2034. Esos dos servicios solo reintentan con P2034, así que un conflicto así terminaría en 500 en lugar de reintentarse.
Evidencia: observado en reservas antes de completar la corrección (14 respuestas 500 con esa causa); en las carreras clínicas y de cierre no apareció (0 de 10).
Corrección recomendada: usar el helper nuevo isSerializationFailure() también en esos dos servicios.
¿Requiere aprobación?: no (mismo arreglo), pero no se aplicó porque ningún test lo reprodujo en esos módulos.
```

```text
ID: MP-CONC-003
Severidad: BAJO
Estado: DECISIÓN PENDIENTE
Área: Regla de agendamiento
Hallazgo: la API acepta horas fuera de la cuadrícula que ofrece available-slots (ej. 09:30 cuando solo se anuncian 09:00, 10:00…). Con la corrección ya no se producen solapes, pero una reserva a las 09:30 deja huecos de 30 minutos inutilizables.
Propuesta: aceptar solo inicios que coincidan con los slots ofrecidos (múltiplos de 60 desde el inicio del bloque). Es un cambio de regla de negocio: requiere decisión.
```

## 1.7 Integridad de la base de datos

| Garantía | Estado |
| --- | --- |
| Una nota principal por cita | `UNIQUE (appointmentId)` presente. Verificado en Nivel I (C10 y carrera de notas). |
| Una relación por pareja paciente–psicólogo | `UNIQUE (patientId, psychologistId)` presente. |
| Sin citas solapadas por psicólogo o por paciente | **No hay restricción en la base.** Solo la lógica de la aplicación (ahora SERIALIZABLE). |
| SERIALIZABLE + reintento | Antes: solo en el módulo clínico y en el cierre de citas. Ahora también en crear y reagendar citas. |
| Conflictos como 409 | Sí, tras la corrección (0 respuestas 500 en 60 carreras de servicio y 3 HTTP). |
| Varias instancias de la API | SERIALIZABLE lo resuelve PostgreSQL, así que funciona con varias instancias; no se probó con dos procesos. |

```text
ID: MP-CONC-004
Severidad: MEDIO
Estado: PROPUESTA (no aplicada)
Área: Esquema PostgreSQL — defensa en profundidad
Propuesta: restricciones de exclusión para que la base rechace solapes aunque falle la aplicación:
  CREATE EXTENSION IF NOT EXISTS btree_gist;
  ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_no_overlap_psychologist"
    EXCLUDE USING gist ("psychologistId" WITH =, "appointmentDate" WITH =,
                        int4range("startMinute", "endMinute") WITH &&)
    WHERE (status = 'SCHEDULED');
  -- y la misma con "patientId".
Antes de aplicarla: comprobar que no existen solapes actuales (si los hay, la migración falla) y mapear el error 23P01 a 409.
¿Requiere aprobación?: sí (migración nueva sobre la base real).
```

## 1.8 Secretos

Escáner propio offline (`secret_scan.py`, en la carpeta temporal de la auditoría). Solo imprime tipo de
patrón, ruta y conteo, **nunca el valor**.

| Superficie | Herramienta / inspección | Cobertura | Hallazgo (sin valor) | Riesgo | Acción |
| --- | --- | --- | --- | --- | --- |
| Código versionado | patrones: URL Postgres con contraseña, JWT, claves privadas, `service_role`, AWS, GitHub, asignaciones de `JWT_SECRET`/`DATABASE_URL`/SMTP/VAPID | todos los archivos de `git ls-files` | 2 coincidencias en `apps/api/.env.example`: **falsos positivos**, los valores están vacíos (longitud 0); 1 mención textual de `service_role` en `docs/security.md` | ninguno | ninguna |
| Historial Git | mismo escáner sobre las líneas añadidas de cada commit | 20 commits, todas las ramas locales | las mismas 2 líneas vacías de `.env.example` (commit `59a79c0`) y la mención en docs | ninguno | ninguna |
| Archivos `.env` en Git | lista de archivos de cada commit | 20 commits | **nunca** se versionó un `.env` real; `.gitignore` protege `apps/api/.env` y `apps/web/.env*` (verificado con `git check-ignore`) | ninguno | ninguna |
| Build de Next (`.next/static` y `.next/server`) | escáner + nombres de variables privadas | 32 + 507 archivos | 0 coincidencias; sin sourcemaps públicos | ninguno | ninguna |
| Variables `NEXT_PUBLIC_*` | `rg` | `apps/web` | solo `NEXT_PUBLIC_API_URL` (URL pública de la API) | ninguno | ninguna |
| Respuestas HTTP | caso S1 | 52 respuestas de la suite I | sin `passwordHash` ni notas ajenas | ninguno | ninguna |
| Logs | revisión de código | `apps/api/src` | `bootstrap-admin.ts` imprime id, correo y rol del admin creado (no la contraseña ni el hash); Nest registra en consola los errores no controlados → MP-SEC-002 | bajo | ver hallazgo |
| CI / workflows | búsqueda de `.github/` | repositorio | no hay workflows | n/a | — |

```text
ID: MP-SEC-002
Severidad: BAJO
Estado: POTENCIAL
Área: Logs del servidor
Hallazgo: los errores no controlados se registran con el manejador por defecto de Nest. Un error de Prisma inesperado podría escribir parte de la consulta en el log del servidor (no en la respuesta: el cliente recibe un 500 genérico). El módulo clínico y el cierre de citas ya lo evitan.
Corrección recomendada: filtro global de excepciones que registre solo el código de error.
¿Requiere aprobación?: no.
```

## 1.9 RLS de Supabase

Consulta de **solo lectura al catálogo** (`rls-check.cjs`), sin leer filas de usuarios:

| Comprobación | Resultado |
| --- | --- |
| Tablas en `public` | 9 |
| Tablas sin RLS | **0** |
| Permisos de `anon` sobre tablas de `public` | **0** (sin políticas) |
| Permisos de `authenticated` sobre tablas de `public` | **0** (sin políticas) |

La migración `20261015120000_lock_down_supabase_data_api` sigue vigente en la base real: la Data API de
Supabase no puede leer ni escribir ninguna tabla. La aplicación usa el rol propietario vía Prisma.

## 1.10 JWT, CORS, CSP, límites de peticiones y TRUST_PROXY

| Control | Hallazgo | Evidencia |
| --- | --- | --- |
| JWT | HS256 fijado al firmar y al verificar; 15 min. Se rechazan `alg: none`, HS512, firma de otra clave, token vencido y rol adulterado. No hay `iss`/`aud` (bajo impacto con una sola API). | H (auth-security), I (A6a–e) |
| Almacenamiento web | Token en `sessionStorage` (riesgo conocido ante XSS, mitigado por CSP). | `docs/security.md` |
| CORS | Lista explícita (`CORS_ORIGINS`), sin comodín ni credenciales, métodos limitados. | código (`main.ts`) |
| CSP / cabeceras | `default-src 'self'`, `frame-ancestors 'none'`, `nosniff`, HSTS en producción; `'unsafe-inline'` en scripts (riesgo conocido). | `next.config.ts` |
| Límites | 120/min por ruta e IP; login 20/15 min; registro 5/h; citas 30/h; alertas 20/min; usuarios internos 30/h. | código, H, I (S2) |
| TRUST_PROXY | Apagado por defecto: un `X-Forwarded-For` falsificado **no** reinicia el límite (21 intentos con IP distinta → 429). | I (S2) |

```text
ID: MP-SEC-003
Severidad: MEDIO
Estado: CONFIRMADO (por diseño)
Área: Límites detrás de NAT / proxy
Hallazgo: los límites son por IP. Todo el personal de una clínica detrás de una misma IP comparte 120 peticiones/min por ruta y 20 intentos de login cada 15 min. Además, en Hostinger, si TRUST_PROXY no se configura, todos los usuarios aparecerán con la IP del proxy y compartirán un único cupo.
Corrección recomendada: al desplegar, fijar TRUST_PROXY al número real de proxies; para rutas autenticadas, usar el `sub` del JWT como clave del limitador.
¿Requiere aprobación?: sí (cambia la política de límites).
```

## 1.11 Rendimiento

**Herramienta:** `apps/api/test/performance/read-load.cjs` (Node, sin dependencias externas; no hay k6
instalado). Solo `GET`. Se niega a apuntar a hosts no locales.

**Entorno (Nivel P):** portátil AMD Ryzen 7 7730U (16 hilos), 15 GB de RAM, Windows 11, Node 24.11.
API compilada (`node dist/src/main.js`, puerto 3941) con `ThrottlerGuard` activo, contra el PostgreSQL de
prueba **en la misma máquina** (sin latencia de red). Volumen sintético: 300 pacientes, 5 psicólogos,
3 000 citas (600 por psicólogo), 100 relaciones clínicas y 240 notas sintéticas.

**Método:**

- Escalones de 1 → 5 → 10 → 25 usuarios virtuales (VUs), 20 s cada uno, con tasa fija de 1,65
  solicitudes/s por ruta (96/min) para no superar el límite de la propia API (120/min por IP y ruta).
- Ráfagas de 5, 10 y 25 solicitudes **simultáneas** por ruta, al final.
- Paradas automáticas: 5xx > 1 %, p95 > 3 s o timeouts. No se activó ninguna.

**Nota honesta sobre los VUs:** con la tasa limitada y respuestas de pocos milisegundos, nunca hubo más de
una petición en vuelo durante los escalones (columna «máx. en vuelo» = 1). Los escalones miden latencia
sostenida, no concurrencia. **La concurrencia real se midió con las ráfagas.** El 50 VUs no se ejecutó.

| Escenario | Escalones (4 × 32 req): p50 / p95 / máx | Ráfaga 5: p95 | Ráfaga 10: p95 | Ráfaga 25: p50 / p95 | 5xx | 429 |
| --- | --- | --- | --- | --- | --- | --- |
| A · `GET /appointments/available-slots` | 4–5 / 5–12 / 44 ms | 155 ms | 60 ms | 29 / 35 ms | 0 | 0 |
| B · `GET /appointments/me` (paciente) | 4 / 4–5 / 10 ms | 9 ms | 17 ms | 29 / 32 ms | 0 | 0 |
| C · `GET /appointments/psychologist/me` (600 citas) | 7–9 / 9–12 / 32 ms | 24 ms | 43 ms | **94 / 119 ms** | 0 | 0 |
| D · `GET /clinical/patients` | 4 / 5–7 / 19 ms | 13 ms | 16 ms | 26 / 31 ms | 0 | 0 |
| E · `GET /auth/me` | 2 / 2–3 / 3 ms | 3 ms | 4 ms | 8 / 11 ms | 0 | 0 |
| F · `GET /clinical/alerts` (0,3 req/s) | 13–14 / 14–75 ms (20 de 24 con 200) | 429 ×5 | 429 ×10 | no medido | 0 | 19 |

**Totales:** 879 solicitudes, **0 errores 5xx, 0 timeouts**. Los 19 `429` son todos de alertas: su
límite es 20/min y la escalera envió 24 en ~80 s, más las ráfagas. Es **throttling esperado por diseño**,
no falta de capacidad; por eso la latencia de alertas bajo ráfaga quedó sin medir (BLOQUEADO por la
propia política, que no se desactivó).

**Recursos de la API:** memoria de 101 MB al inicio, pico de 173 MB y estable en ~165 MB al final (sin
crecimiento continuo). CPU media < 2 % de un núcleo en los escalones. En las ráfagas la medición de CPU
no es fiable (ventanas de milisegundos).

**Web (Next):** no se midió carga sobre las páginas; solo se verificó su funcionamiento en §2.

```text
ID: MP-PERF-001
Severidad: BAJO
Estado: CONFIRMADO
Área: Agendas sin paginación
Hallazgo: GET /appointments/psychologist/me y GET /appointments/me devuelven todo el historial. Con 600 citas por psicólogo fue el endpoint más lento (p95 119 ms con 25 simultáneas, el triple que los demás) y la respuesta crece sin límite con el tiempo.
Corrección recomendada: paginar o limitar a una ventana de fechas (ej. próximas + últimos 90 días).
¿Requiere aprobación?: no (cambia el contrato de la API: coordinar con el frontend).
```

## 1.12 Usuarios simultáneos: qué significa lo medido

Son cuatro preguntas distintas y no deben mezclarse:

1. **¿Cuántas cuentas cabe guardar?** Las que admita PostgreSQL/Supabase: millones de filas. No dice
   nada sobre uso simultáneo.
2. **¿Cuántas personas pueden tener sesión abierta?** Ilimitadas para la API: el JWT no ocupa memoria en
   el servidor. Tener la app abierta no genera peticiones.
3. **¿Cuántas peticiones simultáneas soportó esta máquina?** Ver §1.11: ráfagas de 25 lecturas
   simultáneas por ruta sin errores y con p95 ≤ 119 ms, medidas en un portátil, con la base en el mismo
   equipo y sin latencia de red. No se probaron más de 25 a la vez.
4. **¿Cuántos usuarios aguantará Hostinger + Supabase?** **No se puede afirmar con estos datos.** En
   Hostinger Business la web y la API compartirán CPU y memoria, y cada consulta a Supabase añade la
   latencia de red hasta su región (normalmente decenas de milisegundos, frente a < 1 ms aquí). Además,
   todos los usuarios de una clínica detrás de una misma IP comparten los límites por IP (MP-SEC-003).

Lo que sí se puede decir: el código de la API no mostró cuellos de botella ni crecimiento de memoria en
lecturas típicas; el factor limitante en producción será la red hacia Supabase y los límites por IP, no
el procesamiento en Nest.

## 1.13 Tests agregados

| Archivo | Nivel | Contenido |
| --- | --- | --- |
| `apps/api/test/integration/setup-isolated-database.ts` | — | Guarda: solo URL local y base con «test»; nunca usa `DATABASE_URL`. |
| `apps/api/test/integration/support/fixtures.ts` | — | Fixtures sintéticos y limpieza solo de lo creado. |
| `apps/api/test/integration/appointments-concurrency.integration-spec.ts` | I | 10 tests, 60 carreras simultáneas con conteo en la base. |
| `apps/api/test/integration/security-authorization.integration-spec.ts` | I | 20 tests, 59 casos de la matriz BOLA/IDOR, 3 carreras HTTP, exposición y `X-Forwarded-For`. |
| `apps/api/test/jest-integration.json` + script `npm run test:integration` | — | Configuración separada; las suites aisladas siguen bloqueando la base. |
| `apps/api/src/database/serialization-failure.spec.ts` | U | 3 tests del reconocimiento de conflictos de serialización. |
| `apps/api/test/performance/` (`README.md`, `seed-synthetic.cjs`, `read-load.cjs`) | P | Volumen sintético y carga de solo lectura acotada; se niegan a apuntar a hosts remotos. |

## 1.14 Tests ejecutados

Ejecución final, después de todos los cambios:

| Suite | Nivel | Total | Pasan | Fallan | Bloqueados |
| --- | --- | --- | --- | --- | --- |
| API unitarios (`npm test`) | U | 37 | 37 | 0 | 0 |
| API HTTP aislados (`npm run test:e2e`) | H | 170 | 170 | 0 | 0 |
| API integración (`npm run test:integration`), 2 corridas seguidas + 1 por el script npm | I | 30 por corrida | 30 | 0 | 0 |
| Web (`node --test tests/*.test.mjs`) | U/H | 71 | 71 | 0 | 0 |
| Carga de solo lectura | P | 879 solicitudes | 0 5xx | — | alertas en ráfaga (por política) |

Notas:

- **Antes de la corrección**, la suite de concurrencia falló 5 de 10 tests (§1.6). Esa corrida es la
  evidencia del defecto.
- El caso A8c (paciente inactivo) se registra como FAIL en la matriz pero el test no lo afirma, para que
  la suite siga siendo una red de regresión; está documentado como MP-SEC-001.
- La guarda de la base se probó: sin `INTEGRATION_DATABASE_URL` la suite no arranca, y con una URL
  remota responde «Refusing to run».

## 1.15 Build, lint, TypeScript y Prisma

| Comprobación | Resultado |
| --- | --- |
| API · TypeScript (`tsc --noEmit`) | OK |
| API · `nest build` | OK |
| API · `prisma validate` / `prisma generate` | OK / OK (Prisma Client 7.10.0) |
| API · `prisma migrate status` contra Supabase (solo consulta) | 7 migraciones, «Database schema is up to date» |
| API · ESLint en archivos nuevos o modificados | 0 errores |
| API · ESLint en el resto | 28 errores de formato (prettier) **preexistentes** en archivos con el estilo antiguo (`database.module.ts`, `prisma.service.ts`, `staff.module.ts`, `create-staff-user.dto.ts`). No se ejecutó `eslint --fix` global para no reformatear decenas de archivos ajenos a la auditoría. |
| Web · TypeScript / `next build` | OK / OK |
| Web · ESLint | 0 errores, 1 aviso preexistente (`MentalPiecesIcon` sin usar en `login/page.tsx`) |
| `git diff --check` | limpio |

## 1.16 Hallazgos clasificados

| ID | Severidad | Estado | Área | Resumen | ¿Aprobación? |
| --- | --- | --- | --- | --- | --- |
| MP-CONC-001 | CRÍTICO | **RESUELTO** en código (Nivel I); falta desplegar | Reservas | Doble reserva en 19/20 carreras; también solapes, paciente doble y límite de 4 superado. Corregido con SERIALIZABLE + reintento → 409. | No |
| MP-SEC-001 | MEDIO | CONFIRMADO | Auth | Paciente desactivado conserva acceso hasta 15 min en rutas de paciente. | Sí |
| MP-SEC-003 | MEDIO | CONFIRMADO | Límites | Límites por IP: una clínica tras NAT comparte cupos; en Hostinger es obligatorio configurar `TRUST_PROXY`. | Sí |
| MP-CONC-002 | MEDIO | POTENCIAL | Transacciones | El módulo clínico y el cierre de citas no reconocen la forma `DriverAdapterError` del conflicto 40001 → posible 500 en vez de reintento. | No |
| MP-CONC-004 | MEDIO | PROPUESTA | Esquema | Sin restricción de exclusión en la base contra solapes (defensa en profundidad). | Sí (migración) |
| MP-SEC-002 | BAJO | POTENCIAL | Logs | Errores no controlados se registran con el manejador por defecto de Nest. | No |
| MP-CONC-003 | BAJO | DECISIÓN PENDIENTE | Regla de agenda | Se aceptan horas fuera de la cuadrícula (09:30) y dejan huecos inutilizables. | Sí (regla) |
| MP-PERF-001 | BAJO | CONFIRMADO | Rendimiento | Agendas sin paginación; la del psicólogo es la más lenta y crece sin límite. | No |
| MP-SEC-004 | BAJO | CONFIRMADO (conocido) | Sesión / CSP | JWT en `sessionStorage`, CSP con `'unsafe-inline'`, JWT sin `iss`/`aud`. Ya listado en `docs/security.md`. | Sí (Auth) |

**Sin hallazgos** en: BOLA/IDOR, acceso de ADMIN/STAFF a notas, secretos en código/historial/build, RLS
de Supabase, validación de JWT, CORS y suplantación de IP vía `X-Forwarded-For`.

---

# 2. Pruebas de Usabilidad – Resultados

## 2.1 Método y límites

- **Tipo de prueba:** inspección experta (evaluación heurística de Nielsen y recorrido cognitivo por
  tareas) en el navegador, más comprobaciones automáticas de accesibilidad en cada pantalla.
- **No es una prueba con usuarios reales:** no hubo participantes, así que no hay tasas de éxito ni
  tiempos de usuarios ni cuestionario SUS. El protocolo para hacerla está en §2.6.
- **Entorno:** build de producción de la web (`next start`) contra la API local y la base de pruebas, con
  cuentas sintéticas (paciente, psicóloga, administrador). Escritorio (1366 px) y móvil (375 px).
- **Severidad (escala de Nielsen):** 0 = no es problema · 1 = cosmético · 2 = menor · 3 = mayor ·
  4 = catástrofe.

## 2.2 Tareas evaluadas (recorrido cognitivo)

| # | Tarea | Rol | Pasos observados | Resultado | Observaciones |
| --- | --- | --- | --- | --- | --- |
| T1 | Registrarse e ingresar | Visitante | Registro: 3 campos + 1 clic. Luego login: 2 campos + 1 clic. | Completada | Tras registrarse vuelve al login **sin mensaje de éxito y con el correo vacío** (UX-04). |
| T2 | Agendar una cita | Paciente | 4 clics: psicólogo → fecha sugerida → hora → «Confirmar cita» | Completada | Pasos numerados, días de atención visibles, resumen antes de confirmar y aviso «Cita agendada». |
| T3 | Reagendar y cancelar | Paciente | Cancelar: 2 clics con confirmación. Reagendar: selector de fecha nativo. | Completada | Cancelar sugiere «Reagendar» como alternativa. Reagendar no muestra días de atención ni fechas sugeridas (UX-05). |
| T4 | Gestionar disponibilidad | Psicólogo | Eliminar bloque: 2 clics con confirmación | Completada | En móvil el formulario para añadir queda debajo de los 5 días (UX-10). |
| T5 | Cerrar una cita y escribir la nota | Psicólogo | «Ver pendientes» → «Marcar realizada» → Mis pacientes → paciente → nota → vincular cita → guardar (≈ 7 pasos) | Completada | El aviso «1 sesión pendiente de cierre» es muy claro. El cierre no pide confirmación (UX-06) y no hay atajo a la nota (UX-07). |
| T6 | Crear un psicólogo y asignarle un paciente | Administrador | Crear: tipo + 4 campos + clic. Asignar: 2 selectores + clic. | Completada con dificultad | Con 300 pacientes el selector muestra 50 a la vez y no tiene búsqueda (UX-02). |

## 2.3 Comprobaciones automáticas de accesibilidad

Se revisaron 12 pantallas: login, registro, inicio y citas del paciente, agendar, agenda, paciente y
disponibilidad del psicólogo, y las 4 pantallas del administrador. Anchos: 375 px y 1024 px.

| Criterio | Resultado |
| --- | --- |
| Idioma del documento (`lang="es"`) | 12/12 |
| Un único `h1` por pantalla | 12/12 |
| Botones o enlaces sin nombre accesible | 0 |
| Campos de formulario sin etiqueta asociada | 0 |
| Imágenes sin `alt` | 0 |
| Desbordamiento horizontal a 375 px y a 1024 px | 0 |
| Foco visible al navegar con teclado | Sí (contorno del navegador) |
| Objetivos táctiles < 24 px | Solo el enlace «123» (línea de emergencia) dentro del texto del pie (UX-09) |
| Enlace «saltar al contenido» | No existe (UX-11) |
| Contraste del botón principal | App interna: verde #365b45 con texto blanco = **7,67:1** (cumple AA). Login y registro: #6b8f71 = **3,63:1** (no cumple AA) (UX-03) |

## 2.4 Hallazgos de usabilidad

Severidad de Nielsen: 3 = mayor, 2 = menor, 1 = cosmético.

| ID | Sev. | Heurística | Hallazgo | Recomendación |
| --- | --- | --- | --- | --- |
| UX-01 | 3 | Ayuda a recuperarse de errores | «¿Olvidaste tu contraseña?» se ve como enlace, pero no es interactivo y no existe recuperación de contraseña. | Implementar recuperación, o reemplazar el texto por «Contacta a la clínica para restablecerla». |
| UX-02 | 3 | Flexibilidad y eficiencia | Asignaciones: con 300 pacientes el selector muestra 50 por página y no tiene búsqueda. | Buscador por nombre o MRN. |
| UX-03 | 2 | Accesibilidad (WCAG 1.4.3) | Login y registro: botón 3,63:1 y texto de ayuda 3,48:1, por debajo de 4,5:1. | Usar `.btn-primary` (verde bosque) y oscurecer el texto de ayuda. |
| UX-04 | 2 | Visibilidad del estado | Tras crear la cuenta no hay confirmación y hay que volver a escribir el correo. | Mensaje «Cuenta creada, inicia sesión» y correo precargado. |
| UX-05 | 2 | Consistencia; prevención de errores | Reagendar usa un campo de fecha sin indicar qué días atiende el psicólogo. | Reutilizar las fechas sugeridas y los horarios del flujo de agendar. |
| UX-06 | 2 | Prevención de errores | «Marcar realizada / inasistencia» se aplica con un clic, sin confirmación ni deshacer. | Confirmación breve o «Deshacer» durante unos segundos. |
| UX-07 | 2 | Eficiencia | Tras marcar una cita como realizada no hay acceso directo para escribir su nota. | Botón «Escribir nota» en la cita realizada. |
| UX-08 | 2 | Reconocer antes que recordar | Pacientes sin perfil completo aparecen como «Paciente sin nombre» en agendas y asignaciones; solo se distinguen por MRN. | Pedir el nombre al registrarse o mostrar un dato identificable al personal autorizado. |
| UX-09 | 1 | Visibilidad | La línea de emergencia «123» es un enlace pequeño en texto de 12 px en el pie. | Darle más tamaño y contraste. |
| UX-10 | 1 | Eficiencia (móvil) | El formulario para añadir disponibilidad queda al final de la lista. | Botón «Añadir horario» arriba. |
| UX-11 | 1 | Accesibilidad | No hay enlace «saltar al contenido». | Añadirlo en el encabezado. |
| UX-12 | 1 | Estética | En móvil el texto del selector de cita de la nota se corta («09:00 – 10:»). | Texto más corto o selector a ancho completo. |

## 2.5 Fortalezas observadas

- La zona horaria (Bogotá) se indica en todas las pantallas con horas.
- Agendar tiene pasos numerados, fechas sugeridas, días de atención y un resumen antes de confirmar.
- Las acciones destructivas (cancelar cita, eliminar horario, finalizar relación) piden confirmación y
  ofrecen una alternativa.
- Cada estado tiene color y texto (Programada, Pendiente de cierre, Realizada, Cancelada…).
- Mensajes de éxito tras cada acción y avisos claros de pendientes para el psicólogo.
- Diseño responsive sin desbordamientos a 375 px.

## 2.6 Protocolo para pruebas con usuarios reales (pendiente)

1. **Participantes:** 5 por perfil (pacientes, psicólogos, personal administrativo). Con 5 personas se
   detecta la mayoría de los problemas graves.
2. **Tareas:** las seis de §2.2, leídas en voz alta, sin ayuda del moderador.
3. **Medidas por tarea:** completada sí/no, tiempo, número de errores y de solicitudes de ayuda.
4. **Al final:** cuestionario SUS (10 preguntas, escala 1–5). Puntaje ≥ 68 = usabilidad aceptable.
5. **Datos:** cuentas y datos sintéticos en un entorno de pruebas; nunca datos clínicos reales.
6. **Consentimiento:** informado y por escrito; grabación de pantalla solo si el participante acepta.

---

# 3. Modificaciones Realizadas

## 3.1 Cambios al código de producción (de esta auditoría)

| Archivo | Cambio | Motivo |
| --- | --- | --- |
| `apps/api/src/modules/appointments/appointments.service.ts` | `create()` y `reschedule()` usan el nuevo `runBookingTransaction()`: transacción **SERIALIZABLE** con hasta 3 intentos; si el conflicto persiste responde 409 «Ese horario acaba de ser reservado. Elige otro horario.». El resto de la lógica no cambia (`git diff -w`: +33/−8 líneas; el diff normal es mayor solo por indentación). | MP-CONC-001 (doble reserva demostrada en PostgreSQL). |
| `apps/api/src/database/serialization-failure.ts` (nuevo) | `isSerializationFailure()`: reconoce P2034 y la forma del adaptador `pg` (`TransactionWriteConflict` / SQLSTATE 40001). | Sin esto, 14 de los conflictos llegaban como 500 (observado). |
| `apps/api/package.json` | Script `test:integration`. | Ejecutar las suites de Nivel I de forma explícita. |

No se cambiaron reglas de negocio, esquema, migraciones, Auth/JWT, CORS, RLS, límites ni política
clínica.

**Cambios previos sin commit (no son de esta auditoría):** el módulo «Usuarios internos» pedido antes
en esta sesión (`apps/api/src/modules/staff/*`, `security/rate-limits.ts`, `apps/web/app/admin/users/`,
`apps/web/lib/internal-users.ts`, `lib/api.ts`, `lib/navigation.ts`, `components/ui.tsx`,
`app/admin/dashboard/page.tsx` y sus tests). La matriz de §1.4 también los cubre (A7d).

## 3.2 Cambios a la base de datos real

**Ninguno.** No hubo escrituras, migraciones ni cambios de permisos en Supabase. Solo hubo dos consultas
de lectura: el catálogo de permisos (§1.9) y `prisma migrate status` (§1.15). Su estado coincide con lo
esperado tras la migración del 2026-10-15.

## 3.3 Plan de remediación

**Quick wins (sin aprobación):**

1. MP-CONC-002: usar `isSerializationFailure()` en `ClinicalTransactionService` y `AppointmentLifecycleService`.
2. MP-SEC-002: filtro global de excepciones que registre solo códigos de error.
3. UX-03, UX-04, UX-07, UX-09 y UX-11 (contraste, mensaje tras registro, atajo a la nota, línea de
   emergencia y salto al contenido).
4. MP-PERF-001: paginar o acotar las agendas.

**Cambios de base de datos (con aprobación):**

5. MP-CONC-004: restricciones de exclusión contra solapes, previa verificación de que no existen
   solapes en la base real.

**Antes de staging:**

6. Desplegar la corrección MP-CONC-001.
7. MP-SEC-003: fijar `TRUST_PROXY` según el proxy de Hostinger y decidir límites por usuario.
8. MP-SEC-001: decidir la revocación inmediata de cuentas desactivadas.
9. MP-CONC-003: decidir la regla de cuadrícula horaria.
10. UX-01 y UX-02: recuperación de contraseña y búsqueda de pacientes.

**Antes de producción:**

11. Token en cookie HttpOnly y CSP con nonce (MP-SEC-004).
12. Almacenamiento compartido (Redis) para los límites si hay más de una instancia.
13. Prueba de carga en staging autorizado (§3.6) y prueba de usabilidad con usuarios reales (§2.6).

## 3.4 Estado de Git al terminar

```text
$ git status --short
 M apps/api/package.json
 M apps/api/src/modules/appointments/appointments.service.ts
 M apps/api/src/modules/staff/dto/create-staff-user.dto.ts        (módulo usuarios internos, previo)
 M apps/api/src/modules/staff/staff.controller.ts                 (previo)
 M apps/api/src/modules/staff/staff.service.ts                    (previo)
 M apps/api/src/security/rate-limits.ts                           (previo)
 M apps/web/app/admin/dashboard/page.tsx                          (previo)
 M apps/web/components/ui.tsx                                     (previo)
 M apps/web/lib/api.ts                                            (previo)
 M apps/web/lib/navigation.ts                                     (previo)
?? apps/api/src/database/serialization-failure.spec.ts
?? apps/api/src/database/serialization-failure.ts
?? apps/api/src/modules/staff/dto/staff-page.dto.ts               (previo)
?? apps/api/test/integration/
?? apps/api/test/jest-integration.json
?? apps/api/test/performance/
?? apps/api/test/staff.e2e-spec.ts                                (previo)
?? apps/web/app/admin/users/                                      (previo)
?? apps/web/lib/internal-users.ts                                 (previo)
?? apps/web/tests/internal-users.test.mjs                         (previo)
?? docs/audits/

$ git diff --check
(sin salida: limpio)
```

Ningún commit, push ni merge. «(previo)» = módulo de usuarios internos, pedido antes de esta auditoría.

**Archivos de esta auditoría:**

- Modificados: `apps/api/src/modules/appointments/appointments.service.ts`, `apps/api/package.json`.
- Nuevos:
  - `apps/api/src/database/serialization-failure.ts` y `.spec.ts`
  - `apps/api/test/jest-integration.json`
  - `apps/api/test/integration/` (guarda, fixtures y 2 suites)
  - `apps/api/test/performance/` (README, semilla sintética y carga)
  - este informe

## 3.5 Cómo reproducir el entorno de Nivel I (sin secretos)

```bash
# Clúster desechable con los binarios de PostgreSQL ya instalados (puerto distinto del 5432)
initdb -D <carpeta-temporal>/pgdata -U mp_test --pwfile=<archivo-con-clave-de-prueba> --auth=scram-sha-256
pg_ctl -D <carpeta-temporal>/pgdata -o "-p 55432 -c listen_addresses=127.0.0.1" start
createdb -h 127.0.0.1 -p 55432 -U mp_test mental_pieces_test
# Migraciones SOLO en esa base
DATABASE_URL=<url local de prueba> npx prisma migrate deploy
# Suites de integración
INTEGRATION_DATABASE_URL=<url local de prueba> npm run test:integration
```

El clúster usado en esta auditoría se detuvo al terminar; vivía en la carpeta temporal de la sesión.

## 3.6 Pruebas pendientes para Hostinger

1. Un **staging autorizado** con su propia base (otro proyecto de Supabase o un branch), nunca la base
   de producción, y solo datos sintéticos.
2. `TRUST_PROXY` configurado y verificado: el límite debe ver la IP real del cliente.
3. Carreras HTTP de reserva (R1–R3) contra staging para confirmar la corrección con la latencia real de
   Supabase.
4. Carga escalonada 10 → 25 → 50 VUs **reales** (tasa no limitada por una sola IP: varias IPs de prueba
   o límites por usuario), vigilando CPU y RAM de Hostinger y las conexiones de Supabase. El script actual
   se niega a apuntar a hosts remotos a propósito: adaptarlo requiere una autorización explícita.
5. Medir la web (Next) y la API **juntas** en el mismo plan de Hostinger, porque compartirán recursos.

## 3.7 Veredicto

| Veredicto | ¿Aplica? | Justificación |
| --- | --- | --- |
| **APTO PARA PRUEBAS LOCALES** | **Sí** | Sin BOLA/IDOR, sin secretos expuestos, RLS correcta y la doble reserva corregida y verificada contra PostgreSQL real. |
| **APTO PARA STAGING CON DATOS SINTÉTICOS** | **Sí, con condiciones** | Desplegar la corrección MP-CONC-001 y configurar `TRUST_PROXY` (MP-SEC-003). |
| **NO APTO AÚN** para producción con pacientes reales | **Sí** | Falta decidir MP-SEC-001 y MP-SEC-003, aplicar la restricción en la base (MP-CONC-004), recuperación de contraseña (UX-01), y pruebas de carga en la infraestructura real y de usabilidad con usuarios. |
