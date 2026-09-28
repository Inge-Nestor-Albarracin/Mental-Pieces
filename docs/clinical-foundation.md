# Fundación clínica y aislamiento de tests

## Estado y alcance

Trabajo sobre `feat/appointments`. Se preservaron los cambios frontend que ya
existían al iniciar esta tarea. No se modificaron frontend, citas, disponibilidad,
Auth general, estrategia JWT, .env ni el bootstrap administrativo legítimo.

La migración aditiva `20260928000523_add_clinical_tracking` se generó con
`prisma migrate dev --name add_clinical_tracking --create-only`, se revisó y luego
se aplicó con `prisma migrate dev --name add_clinical_tracking`. Prisma informó
que la base quedó sincronizada. No se insertaron usuarios, relaciones ni notas.

## Test peligroso neutralizado

`src/app.controller.spec.ts` no era una prueba: importaba `dotenv/config`, leía
variables de bootstrap, hacía hash bcrypt, instanciaba PrismaService, conectaba a
la base, buscaba el correo y podía crear un ADMIN con StaffProfile. Invocaba esa
función al importar el archivo, imprimía el usuario creado y alteraba exitCode
ante errores. Esa lógica no se ejecutó.

Se sustituyó por una prueba de AppController/AppService sin configuración ni DB.
`test/app.e2e-spec.ts` también se aisló: ahora registra solo ese controller y ese
service, en lugar de importar AppModule y conectar la base durante `app.init()`.

Ambas configuraciones Jest mapean PrismaService, el cliente generado y los puntos
de entrada PostgreSQL a clases que fallan al construirse. Los tests clínicos
inyectan fakes explícitos mediante `useValue`. Una prueba verifica estos bloqueos.
No son una sandbox universal para futuras pruebas arbitrarias: cualquier nueva
suite debe conservar esta configuración y evitar clientes de red alternativos.
`src/bootstrap-admin.ts` no se modificó ni ejecutó.

## Decisiones de dominio

1. No existe transición segura de citas a COMPLETED. Se eligió asignación
   explícita por ADMIN, con actor, paciente y psicólogo activos comprobados en DB.
   Una cita SCHEDULED no concede acceso clínico. No se modificó Appointments.
2. CareRelationship conserva una fila por pareja paciente–psicólogo. El índice
   único impide duplicados incluso en solicitudes concurrentes. POST duplicado
   devuelve 409, también si la relación terminó; no reactiva accesos implícitos.
3. ADMIN puede terminar una relación; eso revoca el acceso posterior sin borrar
   notas. La reactivación y las reglas de transferencia quedan para otra tarea.
4. Un psicólogo con relación activa puede leer únicamente sus propias notas.
   Asignar otro profesional no le entrega las notas de autores anteriores.
5. Notas de creación/consulta únicamente. No existen PATCH ni DELETE para notas,
   tampoco para el autor. Correcciones/versionado necesitan requisitos explícitos.
6. No se vincula appointmentId ni se añade sessionDate: no existe todavía un flujo
   seguro que identifique una sesión realizada. createdAt es fecha de registro,
   no una afirmación sobre cuándo ocurrió una sesión.
7. Los listados usan páginas de 20 elementos, `page` entre 1 y 10000, con respuesta
   `{ items, page, pageSize, hasMore }`. No aceptan filtros de identidad arbitrarios.

## Modelos

**CareRelationship:** id, patientId, psychologistId, isActive, assignedAt, endedAt,
createdAt, updatedAt. FK a Patient y User; índice por psicólogo/activo/paciente;
unique(patientId, psychologistId). Las cuentas deben conservar roles y estado
activo para acceder. `endedAt` debe ser nulo además de `isActive=true`.

**ClinicalSessionNote:** id, patientId, psychologistId, content (TEXT), createdAt,
updatedAt. FK a paciente, autor y pareja de CareRelationship. La FK compuesta
impide notas sin una relación existente. El estado activo se valida en backend.
Índice por autor/paciente/fecha/id. Sin borrado en cascada.

**AuditLog:** id, actorUserId, action, resourceType, resourceId, createdAt. Eventos
CARE_RELATIONSHIP_CREATED, CARE_RELATIONSHIP_ENDED y CLINICAL_NOTE_CREATED.
Solo metadatos: sin contenido, perfiles, emails ni tokens. No hay endpoint público
de auditoría. Cada escritura y su evento se confirman en la misma transacción.

La migración crea únicamente estos tres modelos, el enum, índices y claves
foráneas. Se envolvió en BEGIN/COMMIT antes de aplicarla. No contiene cambios a
columnas existentes ni operaciones de modificación de datos. Las migraciones
anteriores permanecen intactas.

## API

| Método y ruta | Rol | Entrada | Respuesta mínima |
| --- | --- | --- | --- |
| GET `/clinical/patients?page=1` | PSYCHOLOGIST | page opcional | Página de `{ id, fullName }` de pacientes asignados activos |
| GET `/clinical/patients/:patientId/notes?page=1` | PSYCHOLOGIST asignado | patientId en ruta; page opcional | Página de notas propias `{ id, content, createdAt, updatedAt }` |
| POST `/clinical/patients/:patientId/notes` | PSYCHOLOGIST asignado | `{ content }` | Nota creada con los mismos cuatro campos |
| POST `/clinical/assignments` | ADMIN activo | `{ patientId, psychologistId }` | `{ id, patientId, psychologistId, isActive, assignedAt, endedAt }` |
| PATCH `/clinical/assignments/:id/end` | ADMIN activo | Cuerpo vacío | Relación finalizada con esos mismos campos |

No se exponen mrn, email, teléfono, dirección, género, passwordHash ni perfiles
completos. La lista de pacientes nunca incluye notas. Las respuestas clínicas
declaran Cache-Control: no-store.

El contenido se recorta con trim y debe contener entre 1 y 10000 caracteres.
ValidationPipe rechaza campos adicionales: authorId, psychologistId, patientId,
role y appointmentId no son válidos en el body de una nota. Los IDs de asignación
usan el formato CUID actual del schema.

## Matriz de autorización

| Actor | Lista clínica | Leer/crear notas de paciente | Crear/terminar asignación |
| --- | --- | --- | --- |
| Sin JWT válido | 401 | 401 | 401 |
| PATIENT | 403 | 403 | 403 |
| STAFF | 403 | 403 | 403 |
| ADMIN activo | 403 | 403 | Permitido |
| PSYCHOLOGIST con relación activa | Solo sus pacientes | Solo notas propias de ese paciente | 403 |
| PSYCHOLOGIST sin relación activa | Paciente ausente | 404 | 403 |

La lista puede devolver cero elementos; eso no concede acceso a un ID conocido.
Una cuenta ADMIN desactivada o con rol cambiado también falla la comprobación
persistida, aunque presente un JWT emitido anteriormente.

## Prevención de BOLA/IDOR

- JwtAuthGuard y RolesGuard reales en ambos controllers.
- Autor obtenido únicamente de request.user.sub.
- ClinicalAccessService centraliza la relación activa y las comprobaciones de
  roles/estado actuales en DB, incluyendo la cuenta del paciente.
- GET/POST notes validan la pareja antes de leer/escribir; los listados de notas
  también incluyen autor, paciente y relación activa en el filtro Prisma.
- Ausencia de relación, revocación, cuenta inactiva y paciente inexistente usan
  el mismo 404 genérico, sin confirmar que el paciente existe.
- No existen rutas para editar notas ajenas o propias ni para borrarlas.
- Administración de asignaciones usa un controller separado y nunca consulta
  contenido de notas.

Autorización, escritura y auditoría usan transacciones Serializable. P2034 se
reintenta hasta tres intentos; agotados, devuelve 409. Una operación concurrente
con revocación puede ordenarse antes de ella; no se promete retirar una respuesta
ya entregada. La semántica transaccional se basa en la
[documentación de Prisma 7](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions).
No se modificó ni se considera resuelta la concurrencia de reservas existente.

Los fallos internos de Prisma se convierten a mensajes genéricos sin adjuntar
la excepción original, para evitar que sus consultas/contenidos lleguen a la
respuesta o al logger de excepciones. No se añadieron logs de cuerpos o notas.

## Validación

- Prisma format / validate / generate: correctos, cliente 7.8.0.
- Nest build y TypeScript completo: correctos.
- Unit tests: 7/7.
- Tests HTTP aislados: 39/39 (guards JWT/roles, DTO y services reales; Prisma fake).
- Lint de archivos modificados/nuevos: correcto.
- Lint backend completo, sin --fix: 425 errores Prettier y 1 warning de promesa
  no manejada en archivos no modificados. No se hizo refactor de esos archivos.
- Se mantienen fuera de alcance los 3 errores y 2 warnings frontend previos:
  efectos en appointments/new:70 y appointments:59/87, dependencia del effect
  en appointments:60 y MentalPiecesIcon sin usar en login.

Cobertura: 401, 403 de PATIENT/STAFF/ADMIN en notas, GET/POST 404 sin relación,
filtros activos/autor, rechazo de identidades inyectadas, trim/límites de contenido,
asignación exclusivamente ADMIN, revocación, duplicados 409, paginación,
sanitización de errores y reintentos de serialización. No se ejecutaron fixtures
ni pruebas de escritura contra PostgreSQL real. Estas pruebas no sustituyen una
prueba de concurrencia o rollback con una DB desechable.

## Archivos

Modificados:

- `apps/api/package.json`
- `apps/api/prisma/schema.prisma`
- `apps/api/src/app.controller.spec.ts`
- `apps/api/src/app.module.ts`
- `apps/api/test/app.e2e-spec.ts`
- `apps/api/test/jest-e2e.json`

Creados:

- `apps/api/prisma/migrations/20260928000523_add_clinical_tracking/migration.sql`
- `apps/api/src/database/test-isolation.spec.ts`
- `apps/api/src/modules/clinical/clinical.module.ts`
- `apps/api/src/modules/clinical/clinical.controller.ts`
- `apps/api/src/modules/clinical/clinical.service.ts`
- `apps/api/src/modules/clinical/clinical-access.service.ts`
- `apps/api/src/modules/clinical/clinical-transaction.service.ts`
- `apps/api/src/modules/clinical/clinical-transaction.service.spec.ts`
- `apps/api/src/modules/clinical/care-relationships.controller.ts`
- `apps/api/src/modules/clinical/care-relationships.service.ts`
- `apps/api/src/modules/clinical/dto/clinical-page.dto.ts`
- `apps/api/src/modules/clinical/dto/create-care-relationship.dto.ts`
- `apps/api/src/modules/clinical/dto/create-clinical-note.dto.ts`
- `apps/api/test/clinical.e2e-spec.ts`
- `apps/api/test/support/database-blocked.ts`
- `apps/api/test/support/prisma-client.ts`
- `docs/clinical-foundation.md`

El cliente Prisma generado es un artefacto local regenerado, no una edición
manual. No hubo commit, push ni merge.

## Pendientes y límites

- Validación controlada con datos sintéticos en una DB desechable para comprobar
  rollback de nota+auditoría, restricciones y carreras creación/revocación.
- No se auditan lecturas ni se añadió protección externa contra alteración de
  auditoría. No hay versionado de notas, reactivación de relaciones, transferencia
  entre profesionales ni idempotencia de POST ante reenvíos del cliente.
- La autorización de múltiples profesionales no implica compartir notas. Esa
  política requerirá una decisión explícita antes de ampliarse.
- Reglas de retención, corrección y acceso posterior al cierre necesitan diseño
  de producto antes de añadir edición o frontend clínico.
- No se implementaron diagnósticos, medicación, IA, archivos, firmas, teleconsulta,
  PWA, notificaciones, estadísticas ni pantallas clínicas.

Siguiente paso: comprobar restricciones/transacciones con una base de pruebas
aislada y resolver explícitamente el flujo de correcciones y cierre asistencial
antes de exponer notas en una interfaz.
