# Fundación clínica, ciclo de vida de citas y aislamiento de tests

## Estado y alcance

El backend incluye asignación clínica explícita por ADMIN, notas privadas del
profesional y finalización de citas por su psicólogo propietario. Una nota puede
vincularse opcionalmente a una cita completada del mismo paciente y autor.

El cierre de la implementación interrumpida se limita a respaldar el schema con
la migración aditiva faltante, revisar y aplicar su SQL en desarrollo, regenerar
Prisma, ejecutar las comprobaciones existentes y actualizar este documento. No
añade funcionalidades ni cambia reglas de negocio.

Se conservan Auth, JWT, roles, frontend, sessionStorage, duración de citas y las
políticas de CareRelationship. No se implementan acceso compartido a notas,
reactivación de relaciones, Waiting List, Notifications, Statistics ni PWA.

## Aislamiento de tests

`src/app.controller.spec.ts` contenía una rutina que importaba `dotenv/config`,
leía variables de bootstrap, hacía hash bcrypt, instanciaba PrismaService y podía
crear un ADMIN con StaffProfile al importar el archivo. Esa rutina se sustituyó
por una prueba de AppController/AppService sin configuración ni DB.
`src/bootstrap-admin.ts` conserva el bootstrap administrativo legítimo y no forma
parte de las pruebas.

`test/app.e2e-spec.ts` registra únicamente AppController/AppService, sin importar
AppModule. Además, intercepta `Socket.prototype.connect` durante la compilación
e inicialización de Nest y exige que no se intente ninguna conexión. Restaura el
spy antes de la petición HTTP local de Supertest.

Las configuraciones Jest unitarias y HTTP mapean PrismaService, el cliente
generado y los puntos de entrada PostgreSQL a clases que fallan al construirse.
`src/database/test-isolation.spec.ts` comprueba esos bloqueos. Las suites clínicas
y de ciclo de vida inyectan fakes explícitos mediante `useValue` y usan guards
JWT/roles, DTO y servicios reales. Ninguna suite requiere PostgreSQL real.

Estas barreras no son una sandbox universal: las nuevas pruebas deben conservar
la configuración y evitar clientes de red alternativos. Los fakes no verifican
restricciones, serialización ni rollback reales de PostgreSQL.

## Decisiones de dominio

1. Solo el psicólogo propietario activo puede cambiar una cita de `SCHEDULED` a
   `COMPLETED` o `NO_SHOW`, una vez alcanzada su hora de finalización.
2. Completar una cita no crea CareRelationship ni concede acceso clínico. La
   asignación sigue siendo explícita por ADMIN, con comprobación de actor,
   paciente y psicólogo activos en DB.
3. CareRelationship conserva una fila por pareja paciente–psicólogo mediante
   `@@unique([patientId, psychologistId])`. Crear la misma pareja devuelve 409,
   incluso si terminó; no reactiva acceso de forma implícita.
4. ADMIN puede terminar una relación y revocar el acceso posterior sin borrar
   notas. Un profesional asignado solo puede leer sus propias notas; asignar
   otro profesional no le entrega el histórico de autores anteriores.
5. Las notas permiten creación y consulta. No existen PATCH ni DELETE, tampoco
   para el autor. Correcciones y versionado requieren una decisión posterior.
6. `ClinicalSessionNote.appointmentId` es opcional. Si se aporta, la cita debe
   pertenecer al mismo paciente y psicólogo y tener estado `COMPLETED`. La
   CareRelationship activa sigue siendo obligatoria. Una cita `NO_SHOW`,
   `SCHEDULED` o `CANCELLED` no habilita una nota vinculada.
7. El MVP admite **una nota clínica principal por cita**, mediante
   `appointmentId String? @unique`. Una segunda nota con el mismo appointmentId
   devuelve 409. Se permiten múltiples notas sin vínculo formal, almacenadas con
   `appointmentId = null`; esta decisión puede evolucionar en otra tarea.
8. Para crear una nota sin vínculo por HTTP se omite `appointmentId`. El DTO
   existente rechaza `null` explícito, cadena vacía o un ID que no cumpla el
   formato CUID. No se cambia ese contrato para cerrar la migración.
9. `createdAt` es la fecha de registro de la nota, no la fecha de la sesión. No
   existe un campo `sessionDate` adicional. El vínculo identifica la cita, sin
   cambiar su fecha ni duración.
10. Los listados usan páginas de 20 elementos, `page` entre 1 y 10000 y respuesta
    `{ items, page, pageSize, hasMore }`. No aceptan filtros arbitrarios de identidad.

## Modelos y migraciones

**CareRelationship:** id, patientId, psychologistId, isActive, assignedAt, endedAt,
createdAt y updatedAt. FK a Patient y User; índice por psicólogo/activo/paciente y
unique(patientId, psychologistId). El acceso requiere `isActive=true`,
`endedAt=null` y cuentas con los roles y estados activos esperados.

**ClinicalSessionNote:** id, patientId, psychologistId, appointmentId nullable y
único, content (TEXT), createdAt y updatedAt. FK a paciente, autor, pareja de
CareRelationship y cita opcional. La FK compuesta exige una relación existente;
el backend valida su vigencia. También valida identidad del paciente/autor y
estado `COMPLETED` de la cita. Índice por autor/paciente/fecha/id. Sin borrado en
cascada; la FK hacia Appointment usa `onDelete: Restrict`.

**Appointment:** conserva fecha, minutos de inicio/fin y estados existentes.
Expone la relación inversa opcional `clinicalNote`. No cambia la duración.

**AuditLog:** id, actorUserId, action, resourceType, resourceId y createdAt. Eventos:

- `CARE_RELATIONSHIP_CREATED`
- `CARE_RELATIONSHIP_ENDED`
- `CLINICAL_NOTE_CREATED`
- `APPOINTMENT_COMPLETED`
- `APPOINTMENT_NO_SHOW`

La auditoría contiene solo metadatos, sin contenido clínico, perfiles, emails ni
tokens. No hay endpoint público de auditoría. Cada escritura y su evento se
ejecutan en la misma transacción.

La migración de fundación `20260928000523_add_clinical_tracking` creó los tres
modelos clínicos, su enum original, índices y FK; se revisó y aplicó previamente.
Las migraciones anteriores se conservan sin cambios.

La migración `20260930203629_link_clinical_notes_to_appointments`, generada con
`prisma migrate dev --name link_clinical_notes_to_appointments --create-only`,
se revisó antes de aplicarse en la base de desarrollo configurada. Contiene cinco
sentencias aditivas: dos valores de ClinicalAuditAction, la columna nullable
`ClinicalSessionNote.appointmentId`, su índice único y FK a Appointment con
`ON DELETE RESTRICT ON UPDATE CASCADE`. No contiene operaciones destructivas ni
modificación de datos existentes. Se conserva el SQL generado por Prisma.

La advertencia de duplicados del índice único es genérica: la columna es nueva,
sin default ni backfill, por lo que las notas existentes quedan sin vínculo
(`NULL`). La comprobación de catálogo confirmó PostgreSQL 17.6; el comentario
del SQL sobre PostgreSQL 11 y anteriores no aplica a esta base.

## API

| Método y ruta | Rol | Entrada | Respuesta mínima |
| --- | --- | --- | --- |
| GET `/clinical/patients?page=1` | PSYCHOLOGIST | page opcional | Página de `{ id, fullName }` de pacientes asignados activos |
| GET `/clinical/patients/:patientId/notes?page=1` | PSYCHOLOGIST asignado | patientId en ruta; page opcional | Página de notas propias `{ id, content, createdAt, updatedAt, appointmentId }` |
| POST `/clinical/patients/:patientId/notes` | PSYCHOLOGIST asignado | `{ content, appointmentId? }` | Nota creada con esos mismos cinco campos |
| POST `/clinical/assignments` | ADMIN activo | `{ patientId, psychologistId }` | `{ id, patientId, psychologistId, isActive, assignedAt, endedAt }` |
| PATCH `/clinical/assignments/:id/end` | ADMIN activo | Cuerpo vacío | Relación finalizada con esos mismos campos |
| PATCH `/appointments/psychologist/me/:id/complete` | PSYCHOLOGIST propietario activo | Cuerpo y query vacíos | `{ id, appointmentDate, startTime, endTime, status: "COMPLETED" }` |
| PATCH `/appointments/psychologist/me/:id/no-show` | PSYCHOLOGIST propietario activo | Cuerpo y query vacíos | `{ id, appointmentDate, startTime, endTime, status: "NO_SHOW" }` |

No se exponen mrn, email, teléfono, dirección, género, passwordHash ni perfiles
completos. La lista de pacientes nunca incluye notas. Las respuestas clínicas y
de finalización declaran `Cache-Control: no-store`.

El contenido de una nota se recorta con trim y debe contener entre 1 y 10000
caracteres. ValidationPipe rechaza campos adicionales como authorId,
psychologistId, patientId y role. `appointmentId` es la única referencia opcional
admitida en el body de una nota. Los IDs de asignación y el appointmentId opcional
usan el formato CUID actual del schema.

Las rutas de finalización rechazan cualquier propiedad adicional en body o
query, incluidos status, patientId, psychologistId, completedAt y role. El estado
destino lo determina la ruta; la identidad procede del JWT.

## Autorización y validación temporal

| Actor | Lista clínica | Leer/crear notas | Crear/terminar asignación | Completar/no-show |
| --- | --- | --- | --- | --- |
| Sin JWT válido | 401 | 401 | 401 | 401 |
| PATIENT | 403 | 403 | 403 | 403 |
| STAFF | 403 | 403 | 403 | 403 |
| ADMIN activo | 403 | 403 | Permitido | 403 |
| PSYCHOLOGIST activo con relación activa | Solo sus pacientes | Solo notas propias del paciente | 403 | Solo cita propia |
| PSYCHOLOGIST activo sin relación activa | Paciente ausente | 404 | 403 | Solo cita propia; no concede acceso clínico |

ClinicalAccessService centraliza los filtros de relación activa y las
comprobaciones actuales de roles/estado, incluida la cuenta del paciente. GET y
POST de notas validan la pareja antes de leer/escribir. Los listados también
filtran por autor, paciente y relación activa. Relación ausente o revocada,
cuenta inactiva y paciente inexistente producen el mismo 404 genérico.

La finalización filtra por ID de cita y `request.user.sub`, junto al rol
PSYCHOLOGIST y estado activo persistidos del propietario. Otro profesional, cita
inexistente o propietario inactivo reciben 404. Un ADMIN desactivado o con rol
cambiado tampoco supera la comprobación persistida de asignaciones aunque
presente un JWT anterior.

El servidor compara `appointmentDate` y `endMinute` almacenados con su hora
actual en `America/Bogota`. Permite la transición desde el instante exacto de
finalización, incluidos límites de medianoche; rechaza citas futuras o en curso
y datos temporales almacenados inválidos. No acepta la hora del cliente. Solo
`SCHEDULED` puede finalizarse; `CANCELLED`, `COMPLETED` y `NO_SHOW` devuelven 400.

Para vincular una nota, una cita inexistente o de otro paciente/profesional
produce 404; una cita propia sin estado COMPLETED produce 400. Ningún vínculo
sustituye la autorización de CareRelationship.

## Auditoría y concurrencia

La autorización, escritura y auditoría clínicas usan transacciones Serializable.
Los conflictos P2034 se reintentan hasta tres intentos; agotados, devuelven 409.
P2002 se traduce a 409 para relaciones duplicadas o una segunda nota principal
de la misma cita, con un mensaje específico para cada operación.

La finalización usa su propia transacción Serializable. La actualización exige
que sigan coincidiendo propietario activo, estado SCHEDULED, fecha, inicio y fin
leídos. Si una reprogramación o finalización cambió la cita, la actualización no
prospera y devuelve 400. P2034 se reintenta hasta tres intentos; en este servicio,
agotar los intentos también devuelve 400. El evento APPOINTMENT_COMPLETED o
APPOINTMENT_NO_SHOW se crea en esa misma transacción.

La cancelación y el reagendamiento existentes también condicionan la escritura
al estado SCHEDULED, para que una lectura anterior no sobrescriba una cita ya
finalizada. No se considera resuelta la concurrencia general de reservas.

Una operación clínica concurrente con revocación puede ordenarse antes de ella;
no se promete retirar una respuesta ya entregada. Los tests con fakes comprueban
los filtros condicionales, reintentos y rechazo al fallar la auditoría. No prueban
el rollback ni la serialización de PostgreSQL real.

Los fallos internos de los servicios clínicos y de finalización se convierten a
mensajes genéricos sin adjuntar la excepción original. No se añaden logs de
cuerpos, consultas ni contenido de notas.

## Validación del cierre (2026-09-30)

- `prisma format`, `prisma validate` y `prisma generate`: correctos; cliente 7.8.0.
- Generación con `--create-only`: correcta, tras habilitar la capacidad de la
  terminal interactiva únicamente para ese proceso (`TERM=xterm-256color`).
  No se modificaron `.env`, configuración de conexión ni reglas de negocio.
- `prisma migrate dev`: informó la aplicación de la nueva migración y después
  terminó con P1017 durante la comprobación posterior. También hubo cierres de
  conexión intermitentes durante intentos previos de generación. No se atribuye
  una causa de infraestructura sin verificarla.
- `prisma migrate status`: salida 0, seis migraciones y
  `Database schema is up to date!`.
- Verificación adicional de solo lectura con
  `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --exit-code`:
  salida 0, `No difference detected.`. Se utilizó para comparar el estado final,
  no para generar ni aplicar SQL.
- Consulta de catálogo en una transacción `READ ONLY`: confirmó columna TEXT
  nullable sin default, ambos valores nuevos del enum, índice único válido,
  FK validada con RESTRICT/CASCADE y migración finalizada sin rollback. El
  checksum de `_prisma_migrations` coincide con el archivo SQL local.
- `nest build` y `tsc --noEmit`: correctos después de regenerar Prisma.
- `pnpm test --runInBand`: 4 suites, 21 tests aprobados, incluidos los 2 tests de
  `test-isolation.spec.ts` que bloquean PrismaService, cliente y drivers reales.
- `pnpm test:e2e --runInBand`: 3 suites HTTP aisladas, 82 tests aprobados.
- Total: 103 tests aprobados, sin conexión de Jest a PostgreSQL real; no se
  añadieron ni retiraron tests ni se redujo su cobertura para este cierre.

La cobertura existente incluye aislamiento de DB; JWT/roles; propiedad de citas;
cuentas inactivas; límites horarios de Bogotá; estados y campos prohibidos;
finalizaciones concurrentes simuladas; protección frente a cancelación o
reagendamiento obsoletos; vínculo opcional; cita ajena, inexistente o no
completada; CareRelationship obligatoria; segunda nota vinculada con 409; notas
sin vínculo; acceso por autor; revocación; paginación; sanitización y reintentos.

No se crearon usuarios, relaciones, citas ni notas sintéticas adicionales. Las
comprobaciones de desarrollo consultaron únicamente metadatos de esquema e
historial de migraciones, sin leer contenido clínico. Esto no sustituye una
prueba posterior de concurrencia y rollback con DB desechable. Queda como riesgo
operativo investigar los cierres P1017 si reaparecen; el estado final aplicado
se verificó independientemente mediante historial, catálogo y comparación.

Los únicos cambios versionables de este cierre son el nuevo `migration.sql` y
este documento. El schema y el código parcialmente implementados se conservan
sin diferencias semánticas; tampoco se modifica el historial anterior.

## Archivos de referencia

- `apps/api/prisma/schema.prisma` y `apps/api/prisma/migrations/`
- `apps/api/src/modules/appointments/appointment-lifecycle.controller.ts`
- `apps/api/src/modules/appointments/appointment-lifecycle.service.ts`
- `apps/api/src/modules/appointments/appointment-time.ts`
- `apps/api/src/modules/appointments/dto/finish-appointment.dto.ts`
- `apps/api/src/modules/appointments/appointments.module.ts`
- `apps/api/src/modules/appointments/appointments.service.ts`
- `apps/api/src/modules/clinical/`
- `apps/api/src/app.controller.spec.ts`
- `apps/api/src/database/test-isolation.spec.ts`
- `apps/api/src/modules/appointments/appointment-time.spec.ts`
- `apps/api/test/app.e2e-spec.ts`
- `apps/api/test/appointment-lifecycle.e2e-spec.ts`
- `apps/api/test/clinical.e2e-spec.ts`
- `apps/api/test/jest-e2e.json` y `apps/api/test/support/`

El cliente Prisma generado es un artefacto local regenerado, no una edición
manual del código. Este cierre no incluye commit, push ni merge.

## Pendientes y límites

- **Compartir históricos:** definir autorización y trazabilidad antes de permitir
  acceso a notas de otro profesional. Tener varios profesionales asignados no
  implica compartir sus notas.
- **Reactivación y episodios:** decidir entre reactivar una relación durable con
  reglas explícitas o introducir episodios asistenciales, por ejemplo
  `CareEpisode`. Actualmente la pareja sigue siendo única incluso tras el cierre;
  no hay reactivación, transferencia ni modelo de episodios.
- **PostgreSQL real:** probar restricciones, rollback de escritura más auditoría
  y carreras de finalización, nota duplicada y creación/revocación en una DB
  desechable con datos sintéticos autorizados. Las pruebas actuales usan fakes.
- **Idempotencia de POST:** diseñar claves y semántica de reenvío. El 409 de una
  cita ya vinculada evita duplicar esa nota, pero no es idempotencia general de
  creación de notas, en especial las que no llevan appointmentId.
- **Versionado/corrección:** decidir cómo corregir notas conservando trazabilidad,
  retención y acceso posterior al cierre antes de añadir edición o frontend.
- No se auditan lecturas ni existe protección externa contra alteración de la
  auditoría. No se implementaron diagnósticos, medicación, IA, archivos, firmas,
  teleconsulta ni pantallas clínicas.
