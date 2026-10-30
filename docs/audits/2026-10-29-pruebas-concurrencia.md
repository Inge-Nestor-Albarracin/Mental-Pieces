# Mental Pieces — Informe de pruebas de concurrencia

**Objetivo del documento:** demostrar, con evidencia reproducible, que las operaciones críticas de Mental
Pieces mantienen la integridad de los datos cuando varias personas actúan **al mismo tiempo** sobre el
mismo recurso. El informe incluye el defecto que se encontró, las modificaciones que lo corrigieron y los
resultados medidos antes y después.

| Dato | Valor |
| --- | --- |
| Fecha de esta ejecución | 29 de octubre de 2026 |
| Primera medición (defecto) | 25 de octubre de 2026, código del commit `fb96975` |
| Corrección | Commit `cab52a4` (rama `main`, publicado en `origin/main`) |
| Componentes probados | API NestJS 11 + Prisma 7.10 (`@prisma/adapter-pg`) + PostgreSQL |
| Tipo de prueba | Integración con transacciones **reales** contra PostgreSQL (no simulaciones) |
| Datos | 100 % sintéticos; ningún paciente real ni la base de producción |

---

## 1. Resumen ejecutivo

| Indicador | Antes de la corrección | Después de la corrección (29-oct, 3 corridas) |
| --- | --- | --- |
| Escenarios de concurrencia que pasan | 4 de 9 | **9 de 9** (en las 3 corridas) |
| Citas duplicadas o solapadas en la base | **34** (en 35 carreras de reserva) | **0** (en 180 carreras) |
| Límite anti-abuso de 4 citas superado | **5 de 5** carreras | **0** |
| Respuestas 500 por conflictos | 14 observadas durante el diagnóstico | **0** |
| Actualizaciones perdidas («dos éxitos incompatibles») | 0 | **0** |
| Carreras HTTP completas (JWT, guards, limitador) | no existían | **3 de 3**: un 201, un 409 y una sola fila |
| Suites de integración completas | — | **4 suites, 68/68 pruebas** |

**Conclusión:** antes de la corrección, dos pacientes que reservaban el mismo horario al mismo tiempo
obtenían **ambos** la cita (doble reserva) en 19 de 20 intentos. Después de las modificaciones del
apartado 6, PostgreSQL garantiza que una sola reserva gana y la otra recibe un `409 Conflict`
comprensible. El resultado se repitió igual en tres ejecuciones consecutivas: **0 violaciones de
integridad y 0 errores 500**.

---

## 2. Alcance

### 2.1 Operaciones críticas probadas

| Operación | Endpoint | Por qué es crítica |
| --- | --- | --- |
| Agendar cita | `POST /appointments/me` | Un horario de un psicólogo solo puede pertenecer a un paciente. |
| Reagendar cita | `PATCH /appointments/me/:id/reschedule` | Mover una cita no puede invadir un horario ocupado. |
| Cancelar cita | `PATCH /appointments/me/:id/cancel` | El estado final debe coincidir con la respuesta recibida. |
| Cerrar cita (realizada o inasistencia) | `PATCH /appointments/psychologist/me/:id/complete` y `/no-show` | Un solo resultado y una sola entrada de auditoría. |
| Nota clínica ligada a una cita | `POST /clinical/patients/:id/notes` | Máximo una nota principal por cita. |
| Límite anti-abuso | regla dentro de agendar | Un paciente no puede tener más de 4 citas futuras. |
| Envío de correos (proceso programado) | CLI `notifications.js process` | Dos ejecuciones simultáneas no pueden enviar el mismo correo dos veces. |

### 2.2 Fuera de alcance

- Carga sostenida y capacidad de usuarios: está en la auditoría del 25-oct, §1.11 y §1.12.
- La infraestructura real (Hostinger y Supabase): no se probó contra ella. Ver §7.
- Varios procesos de la API a la vez: no se probaron dos procesos. La garantía la da PostgreSQL, así que aplica igual, pero no se midió.

---

## 3. Entorno de prueba

| Elemento | Valor |
| --- | --- |
| Equipo | AMD Ryzen 7 7730U (16 hilos), 15,4 GB de RAM, Windows 11 Pro |
| Node.js | 24.11.0 |
| Base de datos | PostgreSQL **18.6** en un clúster local desechable (`127.0.0.1:55432`, base `mental_pieces_test`) |
| Esquema | Las mismas migraciones de producción (`prisma migrate deploy`), incluida la última (`20261028120000_add_data_processing_consent`) |
| ORM / driver | Prisma 7.10 con `@prisma/adapter-pg` (igual que en producción) |
| Ejecutor | Jest con `maxWorkers: 1`, configuración `test/jest-integration.json` |

### 3.1 Protecciones para no tocar datos reales

- `test/integration/setup-isolated-database.ts` **detiene la ejecución** si `INTEGRATION_DATABASE_URL` no apunta a un host local (`127.0.0.1`, `localhost` o `::1`) o si el nombre de la base no contiene «test». Nunca usa la `DATABASE_URL` del archivo `.env`.
- `assertDisposableDatabase()` comprueba de nuevo, ya conectado, que `current_database()` contiene «test».
- Los datos los crea `Fixtures`, con correos `*@example.test`, una etiqueta única por ejecución y textos «sintéticos». Al final borra **solo** las filas que creó.

---

## 4. Metodología

### 4.1 Cómo se provoca una carrera real

Cada carrera lanza las dos operaciones en el **mismo ciclo de eventos**, sin `await` entre ellas:

```ts
// test/integration/appointments-concurrency.integration-spec.ts
function simultaneously(calls: (() => Promise<unknown>)[]): Promise<Outcome[]> {
  return Promise.all(calls.map((call) => timed(call)));
}
```

Las dos llamadas usan los **servicios reales** (`AppointmentsService`, `AppointmentLifecycleService`,
`ClinicalService`), con transacciones reales en PostgreSQL. Así ambas pueden leer el horario como «libre»
antes de que la otra escriba, que es exactamente la condición que causa una doble reserva.

### 4.2 Cómo se verifica (oráculo)

El resultado **no** se juzga por las respuestas: después de cada carrera se **consulta la base de datos**.
Por ejemplo, el número de citas `SCHEDULED` que se solapan en ese horario, el estado final de la cita o
el número de notas y de entradas de auditoría. Una carrera es una **violación de integridad** si la base
queda en un estado imposible según las reglas de negocio.

### 4.3 Métricas registradas por escenario

| Columna | Significado |
| --- | --- |
| N | Número de carreras (cada carrera = 2 operaciones simultáneas). |
| Éxitos | Respuestas correctas (2xx), sumadas en todas las carreras. |
| 409 | Respuestas «conflicto»: la operación perdió la carrera y se informó con claridad. |
| 4xx | Otros rechazos controlados (400, 403 o 404); por ejemplo, la cita ya cambió. |
| 5xx | Errores del servidor. **Deben ser 0.** |
| Violaciones | Carreras que dejaron la base en un estado incorrecto. **Deben ser 0.** |
| p95 | Percentil 95 del tiempo de respuesta de las operaciones de ese escenario, en ms. |

Los resultados se guardan en `concurrency-results.json` en la carpeta indicada por `AUDIT_RESULTS_DIR`,
y se imprimen como tabla al terminar.

### 4.4 Criterios de aceptación

1. **Integridad:** 0 violaciones en todos los escenarios.
2. **Respuesta controlada:** 0 errores 5xx; quien pierde recibe 409 o un 4xx con mensaje claro.
3. **Sin actualizaciones perdidas:** nunca dos respuestas de éxito para cambios incompatibles sobre la misma fila.
4. **Repetibilidad:** el mismo resultado de integridad en ejecuciones consecutivas.

---

## 5. Escenarios y resultados

### 5.1 Catálogo de escenarios

| ID | Escenario | Preparación | Operaciones simultáneas | Invariante verificada en la base |
| --- | --- | --- | --- | --- |
| C1 | Mismo psicólogo y horario | 1 psicólogo y 2 pacientes por carrera; 20 carreras en fechas y horas distintas | A agenda X a las 07:00 ‖ B agenda X a las 07:00 | ≤ 1 cita activa en ese horario |
| C2 | Intervalos superpuestos | 5 carreras | A agenda 09:00 (09:00–10:00) ‖ B agenda 09:30 (09:30–10:30) | ≤ 1 cita activa entre 09:00 y 10:30 |
| C3 | Un paciente, dos psicólogos | 2 psicólogos y 1 paciente por carrera | P agenda con X a las 11:00 ‖ P agenda con Y a las 11:00 | El paciente tiene ≤ 1 cita activa a esa hora |
| C4 | Reagendar contra agendar | A ya tiene cita a las 08:00 | A reagenda a las 15:00 ‖ B agenda a las 15:00 | ≤ 1 cita activa a las 15:00 |
| C5 | Dos reagendamientos de la misma cita | Cita a las 08:00 | Reagendar a 13:00 ‖ reagendar a 17:00 | Exactamente 1 éxito y hora final 13:00 o 17:00 (sin actualización perdida) |
| C6 | Cancelar contra reagendar | Cita a las 08:00 | Cancelar ‖ reagendar a 18:00 | El estado final coincide con la respuesta exitosa |
| C7 | Realizada contra inasistencia | Cita pasada | Marcar realizada ‖ marcar inasistencia | Exactamente 1 éxito y 1 sola entrada de auditoría |
| C8 | Dos notas para la misma cita | Cita realizada con relación clínica activa | Crear nota ‖ crear nota | Exactamente 1 nota para esa cita |
| C9 | Límite de 4 citas futuras | El paciente ya tiene 3 citas futuras | Agendar 12:00 ‖ agendar 14:00 | ≤ 4 citas futuras |
| R1–R3 | Carrera HTTP completa | 2 pacientes por carrera; pasa por JWT, guards, validación y limitador **sin desactivarlo** | `POST /appointments/me` ×2 con el mismo horario | Una respuesta 201, una 409 y 1 sola fila |
| N1 | Reserva y bandeja de correos | 2 pacientes | Agendar ‖ agendar el mismo horario | Solo el ganador tiene correos en cola |
| N2 | Dos procesos de envío | 6 citas, 12 correos pendientes; envío simulado con 30 ms de retardo | `runOnce()` ‖ `runOnce()` | 12 envíos en total, ninguno repetido |
| N3 | Proceso interrumpido | Un correo tomado con permiso de envío vencido | Nueva ejecución | El correo se recupera y no queda bloqueado |

### 5.2 Antes de la corrección (25-oct-2026, commit `fb96975`)

| ID | Escenario | N | Éxitos | 409 | 4xx | 5xx | Violaciones | p95 | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Mismo psicólogo y horario | 20 | 39 | 1 | 0 | 0 | **19** | 10 ms | **FALLA** |
| C2 | Intervalos superpuestos | 5 | 10 | 0 | 0 | 0 | **5** | 6 ms | **FALLA** |
| C3 | Un paciente, dos psicólogos | 5 | 10 | 0 | 0 | 0 | **5** | 13 ms | **FALLA** |
| C4 | Reagendar contra agendar | 5 | 10 | 0 | 0 | 0 | **5** | 10 ms | **FALLA** |
| C5 | Dos reagendamientos | 5 | 5 | 0 | 5 | 0 | 0 | 83 ms | Pasa |
| C6 | Cancelar contra reagendar | 5 | 5 | 0 | 5 | 0 | 0 | 6 ms | Pasa |
| C7 | Realizada contra inasistencia | 5 | 5 | 0 | 5 | 0 | 0 | 16 ms | Pasa |
| C8 | Dos notas | 5 | 5 | 5 | 0 | 0 | 0 | 12 ms | Pasa |
| C9 | Límite de 4 citas | 5 | 10 | 0 | 0 | 0 | **5** | 6 ms | **FALLA** |

**Lectura:** en C1, de 20 carreras, **19 terminaron con dos citas para el mismo psicólogo a la misma
hora**: ambos pacientes recibieron «cita agendada». En C9 los 5 pacientes quedaron con **5 citas**, por
encima del límite de 4. Las operaciones sobre una cita ya existente (C5–C8) sí eran seguras: usaban
actualizaciones condicionales y una restricción única.

Además, durante el diagnóstico, con una primera versión de la corrección, se observaron **14 respuestas
500**. Venían de conflictos de serialización que el adaptador de PostgreSQL reportaba con un formato
distinto del esperado (ver §6.2).

### 5.3 Después de la corrección — re-ejecución del 29-oct-2026 (3 corridas consecutivas)

Cada celda muestra los valores de las corridas 1 / 2 / 3.

| ID | Escenario | N | Éxitos | 409 | 4xx | 5xx | Violaciones | p95 (ms) | Resultado |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| C1 | Mismo psicólogo y horario | 20 | 20 / 20 / 20 | 20 / 20 / 20 | 0 / 0 / 0 | **0 / 0 / 0** | **0 / 0 / 0** | 160 / 88 / 93 | **Pasa** |
| C2 | Intervalos superpuestos | 5 | 5 / 5 / 5 | 5 / 5 / 5 | 0 / 0 / 0 | **0 / 0 / 0** | **0 / 0 / 0** | 35 / 33 / 27 | **Pasa** |
| C3 | Un paciente, dos psicólogos | 5 | 5 / 5 / 5 | 5 / 5 / 5 | 0 / 0 / 0 | **0 / 0 / 0** | **0 / 0 / 0** | 28 / 30 / 30 | **Pasa** |
| C4 | Reagendar contra agendar | 5 | 5 / 5 / 5 | 5 / 5 / 5 | 0 / 0 / 0 | **0 / 0 / 0** | **0 / 0 / 0** | 47 / 35 / 36 | **Pasa** |
| C5 | Dos reagendamientos | 5 | 5 / 5 / 5 | 0 / 0 / 0 | 5 / 5 / 5 | **0 / 0 / 0** | **0 / 0 / 0** | 140 / 30 / 39 | **Pasa** |
| C6 | Cancelar contra reagendar | 5 | 5 / 5 / 5 | 0 / 0 / 0 | 5 / 5 / 5 | **0 / 0 / 0** | **0 / 0 / 0** | 20 / 23 / 23 | **Pasa** |
| C7 | Realizada contra inasistencia | 5 | 5 / 5 / 5 | 0 / 0 / 0 | 5 / 5 / 5 | **0 / 0 / 0** | **0 / 0 / 0** | 40 / 18 / 19 | **Pasa** |
| C8 | Dos notas | 5 | 5 / 5 / 5 | 5 / 5 / 5 | 0 / 0 / 0 | **0 / 0 / 0** | **0 / 0 / 0** | 57 / 26 / 26 | **Pasa** |
| C9 | Límite de 4 citas | 5 | 5 / 5 / 5 | 5 / 5 / 5 | 0 / 0 / 0 | **0 / 0 / 0** | **0 / 0 / 0** | 127 / 33 / 29 | **Pasa** |

Duración de cada suite: 23,3 s, 4,2 s y 4,3 s. La primera corrida es más lenta y tiene los p95 más
altos porque arranca en frío (compilación de TypeScript y conexiones nuevas).

**Lectura:**

- En **todas** las carreras exactamente **una** operación gana. En C1–C4, C8 y C9, la que pierde recibe `409 Conflict` con un mensaje comprensible:
  - «Ese horario acaba de ser reservado. Elige otro horario.»;
  - «El psicólogo ya tiene otra cita programada en ese horario.»;
  - «Ya tienes 4 citas programadas…»
- En C5–C7 la que pierde recibe un `400`, porque la cita ya cambió («La cita cambió y no puede finalizarse. Actualiza la agenda.»). La actualización condicional no encontró la fila en el estado leído, así que **ningún cambio se pierde en silencio**.
- Los tiempos (p95 ≤ 160 ms con la base en el mismo equipo) incluyen los reintentos de SERIALIZABLE. Son una referencia local: en producción se suma la latencia de red hacia Supabase.

**Totales del 29-oct:** 3 corridas × 60 carreras = **180 carreras, 360 operaciones simultáneas**,
**0 violaciones** y **0 errores 5xx**.

### 5.4 Carreras HTTP de punta a punta (29-oct)

Pasan por toda la pila (Nest, `ValidationPipe`, `JwtAuthGuard`, `RolesGuard` y `ThrottlerGuard`
activo) contra la misma base:

| ID | Petición | Respuestas | Filas en la base | Resultado |
| --- | --- | --- | --- | --- |
| R1 | 2 × `POST /appointments/me`, mismo horario | 201 + 409 | 1 | **Pasa** |
| R2 | 2 × `POST /appointments/me`, mismo horario | 201 + 409 | 1 | **Pasa** |
| R3 | 2 × `POST /appointments/me`, mismo horario | 201 + 409 | 1 | **Pasa** |

### 5.5 Concurrencia en el envío de correos (29-oct)

| ID | Prueba | Resultado verificado | Resultado |
| --- | --- | --- | --- |
| N1 | Dos reservas simultáneas del mismo horario | Solo el paciente ganador tiene confirmación y recordatorio en cola, y el psicólogo recibe una sola. El perdedor no tiene ningún correo: la bandeja se escribe en la misma transacción que la cita. | **Pasa** |
| N2 | Dos procesos `runOnce()` a la vez sobre 12 correos | 12 correos tomados en total, 12 enviados, 6 destinatarios distintos y **ningún duplicado**. | **Pasa** |
| N3 | Proceso interrumpido (permiso de envío vencido) | El correo se recupera en la siguiente ejecución, sin quedar bloqueado ni duplicarse. | **Pasa** |

### 5.6 Suites completas (29-oct)

| Suite | Pruebas | Resultado |
| --- | --- | --- |
| `appointments-concurrency.integration-spec.ts` | 10 | 10/10, en 3 corridas |
| `security-authorization.integration-spec.ts` (incluye R1–R3) | 22 | 22/22 |
| `notifications.integration-spec.ts` (incluye N1–N3) | 21 | 21/21 |
| `registration-onboarding.integration-spec.ts` | 15 | 15/15 |
| **Total de integración** | **68** | **68/68** |
| `serialization-failure.spec.ts` (unitaria) | 3 | 3/3 |

---

## 6. Modificaciones realizadas para mejorar la fiabilidad

### 6.1 Causa raíz del defecto

Agendar una cita hacía dos pasos dentro de una transacción con el aislamiento por defecto de
PostgreSQL, **READ COMMITTED**: primero comprobar que el horario está libre y después insertar la cita.
No había ninguna restricción en la base que impidiera los solapes. Con dos peticiones simultáneas:

```text
t0  Petición A: ¿hay cita de X el 30/10 a las 10:00?  → no
t1  Petición B: ¿hay cita de X el 30/10 a las 10:00?  → no   (A aún no ha escrito)
t2  Petición A: INSERT cita (X, 30/10, 10:00)          → OK
t3  Petición B: INSERT cita (X, 30/10, 10:00)          → OK   ← doble reserva
```

Cada transacción, por separado, era correcta; la combinación no. El mismo patrón afectaba al solape
parcial (C2), al paciente con dos psicólogos (C3), a reagendar contra agendar (C4) y al límite de 4
citas (C9).

### 6.2 Modificaciones

| # | Modificación | Archivo(s) | Qué resuelve | Evidencia |
| --- | --- | --- | --- | --- |
| M1 | **Transacción SERIALIZABLE con reintento** (`runBookingTransaction`, hasta 3 intentos). Si el conflicto persiste, responde **409** «Ese horario acaba de ser reservado. Elige otro horario.». | `apps/api/src/modules/appointments/appointments.service.ts` (`create` y `reschedule`) | PostgreSQL detecta que dos transacciones leyeron y escribieron datos dependientes y **aborta una** (SQLSTATE 40001). En el reintento esa operación ya ve la cita de la otra y responde 409. Corrige C1–C4 y C9. | §5.2 → §5.3 |
| M2 | **Detección del conflicto con el adaptador `pg`** (`isSerializationFailure`). Reconoce el código de Prisma `P2034` y la forma del adaptador (`DriverAdapterError`, causa `TransactionWriteConflict` o código `40001`). | `apps/api/src/database/serialization-failure.ts` (+ `.spec.ts`) | Sin esto, algunos conflictos no se reintentaban y llegaban al usuario como **500** (14 observados). | 0 respuestas 5xx en §5.3; 3 pruebas unitarias |
| M3 | **Reglas comprobadas dentro de la misma transacción**. El límite de 4 citas, los solapes del psicólogo y del paciente y, desde el 28-oct, perfil completo y política aceptada (`assertPatientCanBook`) se leen dentro de la transacción SERIALIZABLE. | `appointments.service.ts`, `patients/patient-requirements.ts` | Evita que una regla se cumpla al leer y deje de cumplirse al escribir. | C9 en §5.3; suite de registro 15/15 |
| M4 | **Actualizaciones condicionales** (ya existían; se verificaron). Cancelar, reagendar y cerrar actualizan con `where` que incluye estado, fecha y hora leídos. Si la fila cambió, `count = 0` y la operación se rechaza. | `appointments.service.ts`, `appointment-lifecycle.service.ts` | Ninguna actualización perdida ni estado final contradictorio. | C5–C7, antes y después |
| M5 | **Restricciones únicas en la base** (ya existían; se verificaron): una nota por cita (`appointmentId @unique`), un correo por cuenta (`email @unique`, el conflicto se traduce a 409) y una relación por pareja paciente–psicólogo. | `prisma/schema.prisma` | La base rechaza el duplicado aunque la aplicación falle. | C8 |
| M6 | **Bandeja de correos transaccional** (*outbox*): el correo se encola en la misma transacción que la cita, con clave de idempotencia única. | `notifications/notification-outbox.ts` | Si la reserva pierde la carrera, no queda ningún correo huérfano; reintentar no duplica. | N1 |
| M7 | **Toma atómica de correos** (`FOR UPDATE SKIP LOCKED`) con **permiso de envío por tiempo**: 15 min, mayor que la duración máxima de una ejecución, que es de 4 min. | `notifications/notification-processor.ts` | Dos ejecuciones simultáneas toman correos distintos; un proceso interrumpido no deja correos bloqueados. | N2, N3 |
| M8 | **Infraestructura de prueba reproducible**: guarda de base aislada, fixtures sintéticos con limpieza selectiva, configuración `jest-integration.json` y script `test:integration`. | `apps/api/test/integration/*`, `apps/api/package.json` | Permite repetir estas pruebas en cualquier momento sin riesgo para los datos reales. | Este informe |

Fragmento central de M1:

```ts
// apps/api/src/modules/appointments/appointments.service.ts
private async runBookingTransaction<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await this.prisma.$transaction(operation, { isolationLevel: 'Serializable' });
    } catch (error: unknown) {
      if (!isSerializationFailure(error)) throw error;
      if (attempt >= BOOKING_ATTEMPTS) throw new ConflictException(SLOT_TAKEN_MESSAGE);
    }
  }
}
```

**Lo que no se cambió:** reglas de negocio, esquema de citas, autenticación, permisos, límites de
peticiones y política clínica. La corrección solo cambia **cómo** se ejecutan las mismas comprobaciones.

### 6.3 Por qué SERIALIZABLE y no un bloqueo manual

- **Solapes, no solo duplicados exactos:** una restricción única sobre (psicólogo, fecha, hora) no detecta solapes parciales como 09:00 contra 09:30 (C2). SERIALIZABLE sí, porque compara lo que cada transacción leyó con lo que escribió la otra.
- **Varias instancias de la API:** la garantía la da PostgreSQL, no la memoria del proceso de Node. Sigue siendo válida si la API corre en varias instancias (no se midió con dos procesos; ver §7).
- **Mismo patrón que ya existía:** el módulo clínico y el cierre de citas ya usaban SERIALIZABLE.

---

## 7. Limitaciones y riesgos residuales

| ID | Riesgo | Estado | Mitigación propuesta |
| --- | --- | --- | --- |
| MP-CONC-002 | `ClinicalTransactionService` y `AppointmentLifecycleService` reintentan solo con `P2034`. Un conflicto que llegue con el formato del adaptador (`TransactionWriteConflict`) daría 500 en lugar de reintentarse. En C7 y C8 no ocurrió (0 de 30 en las 3 corridas). | Abierto, bajo | Usar `isSerializationFailure()` también en esos dos servicios. |
| MP-CONC-003 | La API acepta horas fuera de la cuadrícula (09:30). Ya no causa solapes, pero puede dejar huecos inutilizables. | Decisión de negocio pendiente | Aceptar solo inicios alineados con los horarios ofrecidos. |
| MP-CONC-004 | No hay restricción de exclusión en la base contra solapes; la protección depende de la aplicación (SERIALIZABLE). | Propuesta, no aplicada | `EXCLUDE USING gist` sobre (psicólogo, fecha, rango de minutos) para citas `SCHEDULED`, y lo mismo por paciente. Requiere una migración autorizada y verificar antes que no existan solapes. |
| — | Pruebas en un solo equipo, con la base local y sin latencia de red. | Limitación del entorno | Repetir R1–R3 en un staging autorizado con su propia base de Supabase y datos sintéticos. |
| — | No se probaron dos procesos de la API al mismo tiempo. | Limitación | La garantía está en PostgreSQL; confirmarlo en staging con dos instancias. |
| — | Registro simultáneo con el mismo correo: lo protege la restricción única (`P2002` → 409), pero no tiene una prueba concurrente dedicada. | Cubierto por diseño | Añadir una carrera de dos `POST /users` con el mismo correo. |

---

## 8. Cómo reproducir

```bash
# 1. Clúster PostgreSQL desechable (puerto distinto de 5432)
initdb -D <carpeta-temporal>/pgdata -U mp_test --pwfile=<archivo-con-clave-de-prueba> --auth=scram-sha-256
pg_ctl -D <carpeta-temporal>/pgdata -o "-p 55432 -h 127.0.0.1" start
createdb -h 127.0.0.1 -p 55432 -U mp_test mental_pieces_test

# 2. Migraciones SOLO en esa base (desde apps/api)
DATABASE_URL=<url local de prueba> npx prisma migrate deploy

# 3. Pruebas de concurrencia (resultados en $AUDIT_RESULTS_DIR/concurrency-results.json)
INTEGRATION_DATABASE_URL=<url local de prueba> AUDIT_RESULTS_DIR=<carpeta> \
  npx jest --config ./test/jest-integration.json test/integration/appointments-concurrency.integration-spec.ts

# 4. Todas las suites de integración (incluye R1–R3 y N1–N3)
INTEGRATION_DATABASE_URL=<url local de prueba> npm run test:integration
```

Si la URL no es local o el nombre de la base no contiene «test», la suite se niega a ejecutarse.

---

## 9. Trazabilidad

| Elemento | Ubicación |
| --- | --- |
| Pruebas de concurrencia (C1–C9) | `apps/api/test/integration/appointments-concurrency.integration-spec.ts` |
| Carreras HTTP (R1–R3) | `apps/api/test/integration/security-authorization.integration-spec.ts` |
| Concurrencia de correos (N1–N3) | `apps/api/test/integration/notifications.integration-spec.ts` |
| Detección de conflictos | `apps/api/src/database/serialization-failure.ts` y `.spec.ts` |
| Corrección de reservas | `apps/api/src/modules/appointments/appointments.service.ts` (`runBookingTransaction`) |
| Toma atómica de correos | `apps/api/src/modules/notifications/notification-processor.ts` (`claim`) |
| Medición del defecto y primera corrección | `docs/audits/2026-10-25-auditoria-seguridad-concurrencia-rendimiento.md` §1.6 y §3.1 |
| Commits | `fb96975` (antes), `cab52a4` (corrección y pruebas), `ec74b62` / `407aa20` (correos) |
