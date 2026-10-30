# Registro con autorización de datos y perfil obligatorio

Estado: **implementado y probado en local** (base PostgreSQL desechable). **No desplegado.**
La migración **no** se ha aplicado en Supabase. No hay ninguna política legal publicada.

## 1. Recorrido del paciente

```
/register  → correo, contraseña, confirmación y casilla de autorización (desmarcada)
           → POST /users: usuario + perfil vacío + evidencia, en una transacción
/login     → paciente: GET /patients/me →
               ¿falta la autorización vigente? → /autorizacion-de-datos
               ¿falta el perfil?               → /profile/edit?onboarding=1
               si no                           → /dashboard
/profile/edit?onboarding=1 → «Completa tu perfil» → PATCH /patients/me
           → el servidor responde isProfileComplete: true → «¡Tu perfil está completo!» → /dashboard
/appointments/new → POST /appointments/me (el servidor vuelve a comprobarlo todo)
```

Psicólogos, administradores y personal no pasan por este flujo.

## 2. Qué se reutilizó

- Registro (`POST /users`, `UsersService`): mismo hash bcrypt y mismo límite de 5 registros por hora e IP.
- Perfil:
  - `GET` y `PATCH /patients/me`;
  - el formulario `/profile/edit`;
  - el enum `Gender`;
  - el cálculo `isProfileComplete`, ahora más estricto (sección 5).
- Sesión y acceso:
  - la sesión en `sessionStorage`;
  - `RoleGate`, que ahora también encamina a los pacientes;
  - los guards JWT y de roles.
- Reserva: la transacción SERIALIZABLE de `AppointmentsService.create`.
- Pruebas: `Fixtures` de integración, ahora con perfil completo y autorización por defecto.

## 3. Modelo de evidencia

| Tabla | Para qué |
|---|---|
| `LegalDocument` | Texto publicado de la política, una fila por versión. Guarda `kind`, `version`, `title`, `body`, `sha256`, `requiresReacceptance` y `publishedAt`. |
| `DataProcessingConsent` | Evidencia de la aceptación. Guarda `userId`, `documentId`, `purpose = ACCOUNT_DATA_PROCESSING`, `source` (`PATIENT_REGISTRATION` o `EXISTING_ACCOUNT`), copia de `documentVersion` y `documentSha256`, y `acceptedAt`. |

Garantías en la propia base de datos, no solo en el código:

- **Hash exacto del texto**: `sha256` debe ser exactamente el SHA-256 de `body` (restricción CHECK).
- **Política inmutable**: una versión publicada no se edita (disparador); una corrección es una versión nueva.
- **Evidencia solo de inserción**: una aceptación no se puede modificar (disparador).
  - La fecha la fija el servidor de base de datos (`now()`), aunque alguien enviara otra.
  - La versión y el hash copiados deben coincidir con el documento aceptado.
- **Una aceptación por persona y versión**: índice único `(userId, documentId, purpose)`; aceptar dos veces conserva la primera.
- **Acceso restringido**: RLS activado y permisos de `anon`/`authenticated` revocados, igual que el resto de tablas.
- **Nada sensible en la evidencia**: sin contraseñas, JWT, IP ni datos clínicos.

Qué cuenta como «aceptado»: haber aceptado la última versión publicada con `requiresReacceptance = true`, o una posterior. Una versión publicada con `--no-reacceptance` (cambio editorial) no vuelve a pedirla. Sin política publicada o sin fila de evidencia, nunca se considera aceptada.

## 4. Migración preparada

`apps/api/prisma/migrations/20261028120000_add_data_processing_consent/migration.sql`

- **Aditiva**: 3 enums, 2 tablas, índices, CHECK, 2 disparadores y el bloqueo RLS. No modifica ni borra filas existentes.
- **Generada** con `prisma migrate diff` desde la base de pruebas, más el SQL manual de integridad y seguridad.
- **Aplicada** solo en la base local desechable (`mental_pieces_test`); después `migrate diff` quedó vacío.
- **Pendiente en Supabase.**

## 5. Reglas de perfil completo (servidor)

Archivo: `apps/api/src/modules/patients/patient-requirements.ts`.

- **Nombre**: 2 a 120 caracteres, después de quitar espacios; solo espacios no cuenta.
- **Fecha de nacimiento**:
  - fecha de calendario `AAAA-MM-DD` que exista (no 30 de febrero);
  - no futura según la fecha de Bogotá;
  - no anterior a 1900.
- **Teléfono**: 7 a 25 caracteres, con al menos 7 dígitos. Se permiten espacios, `+`, `-`, `( )` y `.`. No se envían SMS.
- **Género**: un valor del enum. «Prefiero no especificarlo» (`PREFER_NOT_TO_SAY`) es válido. Con `OTHER`, el campo `genderOther` no puede quedar vacío.

`isProfileComplete`, `dataPolicyAccepted` y `currentDataPolicyVersion` los calcula el servidor. Enviarlos desde el cliente produce un 400 (lista blanca estricta), igual que `consentAcceptedAt`, `role` o `patientId`.

## 6. Bloqueo de reservas en el backend

`POST /appointments/me` ejecuta `assertPatientCanBook` **dentro** de su transacción SERIALIZABLE. Lee la fila del paciente y la evidencia directamente de PostgreSQL y devuelve 409 cuando:

| Caso | Mensaje |
|---|---|
| Perfil incompleto | «Debes completar tu perfil antes de agendar una cita.» |
| Sin la autorización vigente | «Debes aceptar la Política de Tratamiento de Datos Personales antes de continuar.» |
| **Menor de 18 años** | Reserva en línea no habilitada (ver la sección 9) |

Postman, un `fetch` manual o un cambio en React no lo evitan, porque nada de esto depende del navegador.

No cambiaron disponibilidad, concurrencia, citas futuras, tope de citas, roles ni propiedad de recursos. **Cancelar y reagendar citas existentes no se bloquea**; la cancelación está probada con un perfil incompleto.

`PATCH /patients/me` también exige la autorización vigente: no se recogen datos personales antes de autorizar.

## 7. Pacientes existentes

- No se borra ni se modifica ninguna cuenta, MRN, cita ni nota clínica.
- Ninguna cuenta antigua tiene evidencia, así que al iniciar sesión van a `/autorizacion-de-datos`.
  - Allí leen la política (se abre en otra pestaña), marcan la casilla y pulsan «Aceptar y continuar».
  - Eso llama a `POST /patients/me/data-policy-acceptance`, con origen `EXISTING_ACCOUNT`.
- Después, si les falta el perfil, van a completarlo. Si no, entran normalmente.
- Orden: primero la autorización y luego el perfil, sin bucles. Cada destino es una página que ese mismo estado permite; está probado.

## 8. Archivos

**API — nuevos:**
- `src/modules/legal/data-policy.ts`
- `legal.controller.ts` (`GET /legal/data-processing-policy`, público)
- `legal.module.ts`
- `dto/accept-data-policy.dto.ts`
- `src/modules/patients/patient-requirements.ts` y su `.spec.ts`
- `src/cli/legal.ts` (publicar la política)
- `test/registration-consent.e2e-spec.ts`
- `test/integration/registration-onboarding.integration-spec.ts`
- la migración

**API — modificados:**
- `prisma/schema.prisma`
- `src/app.module.ts`
- `users.service.ts` y `create-patient-user.dto.ts`
- `patients.service.ts`, `patients.controller.ts` y `update-my-profile.dto.ts`
- `appointments.service.ts`
- `test/appointments.e2e-spec.ts` y `test/auth-security.e2e-spec.ts`
- `test/integration/support/fixtures.ts`

**Web — nuevos:**
- `lib/onboarding.ts`
- `app/politica-de-tratamiento-de-datos/` (página pública)
- `app/autorizacion-de-datos/` (cuentas existentes)
- `tests/onboarding.test.mjs`

**Web — modificados:**
- `app/register/page.tsx`, `app/login/page.tsx` y `app/profile/edit/page.tsx`
- `components/role-gate.tsx`
- `lib/api.ts` y `lib/profile.ts`

## 9. Pendiente de revisión legal (no se inventó nada)

1. **El texto de la política no existe todavía.** Debe redactarlo o aprobarlo quien asesore a Mental Pieces (Ley 1581 de 2012 y Decreto 1377 de 2013, compilado en el Decreto 1074 de 2015). Como mínimo debe incluir:
   - responsable (razón social, NIT, domicilio, correo y teléfono);
   - finalidades;
   - derechos del titular;
   - procedimiento de consultas y reclamos;
   - área responsable;
   - fecha de vigencia.

   Mientras no se publique, el registro responde 503 y la reserva queda bloqueada para todos los pacientes. Esto es intencional: no hay autorización sin política.
2. **Menores de edad**: no existe procedimiento de representación ni autorización del representante. La reserva en línea queda bloqueada para menores de 18 (409) y el formulario lo avisa. Hay que decidir el procedimiento antes de habilitarla.
3. **Datos sensibles de salud y consentimiento informado clínico**: no forman parte de esta autorización (finalidad `ACCOUNT_DATA_PROCESSING`). Deben pedirse aparte, en el flujo clínico.
4. **Revocatoria y supresión**: no hay flujo de revocatoria todavía. La evidencia queda ligada al usuario (`ON DELETE RESTRICT`).
5. **Evidencia adicional**: no se guardan IP ni navegador, por minimización. Decidir si el asesor legal los exige.
6. **Etiqueta del género**: hoy «Prefiero no especificarlo». Cambiarla a «Prefiero no decirlo» si así se prefiere.

## 10. Pruebas ejecutadas (resultados reales)

| Suite | Resultado |
|---|---|
| API unitarias (`npx jest`) | 87/87 (6 nuevas) |
| API e2e sin base (`jest-e2e`) | 177/177 (7 nuevas) |
| API integración, PostgreSQL 18 local desechable | 68/68 en 4 suites (15 nuevas) |
| Web (`node --test tests/*.test.mjs`) | 80/80 (8 nuevas) |

La suite de integración nueva cubre:
- registro sin aceptación, con `false`, sin versión o con versión inválida → 400, sin filas;
- campos prohibidos → 400;
- evidencia con hora del servidor;
- fallo simulado al guardar la evidencia → ninguna cuenta parcial;
- login con perfil pendiente, reserva → 409, completar con `PREFER_NOT_TO_SAY` → reserva 201;
- validaciones de nombre con espacios, fechas futuras o imposibles, teléfono en blanco y `OTHER` vacío;
- edición normal;
- cuenta antigua sin evidencia: 409 al editar o reservar, aceptación idempotente;
- perfil incompleto: reserva bloqueada, cancelación permitida y cita intacta;
- menor de edad bloqueado;
- versión nueva con y sin `requiresReacceptance`;
- inmutabilidad y CHECK del hash en la base;
- endpoint público;
- psicólogo y administrador sin cambios.

Compilación y validación:
- `prisma validate` y `prisma generate` correctos;
- `nest build` correcto (incluye `dist/src/cli/legal.js`);
- `next build --webpack` correcto (páginas nuevas estáticas);
- TypeScript y ESLint sin errores nuevos (se mantienen avisos previos de finales de línea CRLF y una variable sin usar en el login);
- `git diff --check` limpio.

Prueba manual en el navegador, con API y web locales sobre la base de pruebas, una política de prueba marcada «NO ES UN TEXTO LEGAL» y un paciente sintético (escenario A):
1. Casilla desmarcada; registrar sin marcarla → bloqueado con mensaje.
2. Marcarla → cuenta creada.
3. Login → `/profile/edit?onboarding=1`.
4. Escribir `/appointments/new` o `/dashboard` en la barra → vuelve al formulario.
5. Guardar → «¡Tu perfil está completo!» → `/dashboard`.
6. Agendar cita → «Cita agendada».

## 11. Despliegue (en este orden)

> Si se despliega el código antes de los pasos 1 y 2, la API falla (faltan tablas) o el registro queda cerrado (no hay política).

1. **Aplicar la migración en Supabase** (requiere tu autorización), desde `apps/api` con la `DATABASE_URL` de Supabase en `.env`:

   ```bash
   npx prisma migrate status
   npx prisma migrate deploy
   ```

   Solo debe aplicar `20261028120000_add_data_processing_consent`.
2. **Publicar la política revisada** (texto final aprobado, en un archivo UTF-8). Desde `apps/api`, después de `pnpm build`, con la misma `DATABASE_URL`:

   ```bash
   node dist/src/cli/legal.js publish --file ruta/politica.md --version 2026-11-01 --title "Política de Tratamiento de Datos Personales" --confirm
   node dist/src/cli/legal.js status
   ```

   Una versión publicada no se puede reemplazar: cada corrección se publica con una versión nueva. Para un cambio solo editorial, que no obliga a aceptar de nuevo, añade `--no-reacceptance`.
3. **Subir el código** (commit y push a `main`). Hostinger redespliega la API y la web con la misma configuración de antes: build `prisma generate && nest build`, salida `dist`, entrada `src/main.js`. No hay dependencias ni variables nuevas.
4. **Verificar:**
   - `https://api.mentalpieces.site/legal/data-processing-policy` → 200 con la versión publicada;
   - `https://mentalpieces.site/politica-de-tratamiento-de-datos` muestra el texto;
   - registro de prueba con un correo propio → redirección al perfil → reserva;
   - un paciente antiguo ve primero `/autorizacion-de-datos`.
