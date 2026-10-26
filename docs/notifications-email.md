# Notificaciones por correo — Mental Pieces

Estado: **implementado y probado en local**. El envío está **desactivado** (`NOTIFICATIONS_ENABLED=false`).
Todavía **no** se ha probado con el SMTP real de Hostinger ni con el cron real de Hostinger.

## 1. Qué hace

| Evento | Paciente recibe | Psicólogo recibe | Cuándo |
| --- | --- | --- | --- |
| El paciente agenda | «Confirmación de tu cita» | «Nueva cita agendada» | Siguiente ciclo del cron (≤ 5 min) |
| El paciente agenda (faltan > 24 h) | «Recordatorio de cita» (si lo activó) | — | 24 h antes del inicio (± 5 min) |
| El paciente cancela | «Cancelación de tu cita» | «Cita cancelada» | Siguiente ciclo; los pendientes se anulan |
| El paciente reagenda | «Cambio de horario de tu cita» | «Cita con nuevo horario» | Siguiente ciclo; lo pendiente del horario viejo se anula |
| El psicólogo cierra (realizada / inasistencia) | — | — | Se anulan los recordatorios pendientes |

El psicólogo recibe su copia en el correo de su cuenta (`User.email` del psicólogo de la cita). El
mensaje enlaza a `/psychologist/appointments` y **no incluye datos del paciente**: los consulta en la
aplicación, detrás del inicio de sesión. No recibe recordatorios de 24 h.

Las citas agendadas con **menos de 24 h** de anticipación reciben solo la confirmación: no se envía un
recordatorio retroactivo.

## 2. Arquitectura

```text
API (NestJS)                                   Cron de Hostinger (cada 5 min)
──────────────                                 ──────────────────────────────
Transacción:                                   node dist/src/cli/notifications.js process
  crear / modificar la cita                       1. recupera trabajos interrumpidos
  escribir filas en "Notification"   ──BD──▶      2. reclama un lote (FOR UPDATE SKIP LOCKED)
COMMIT                                            3. revisa la cita REAL de cada mensaje
                                                  4. envía por SMTP (fuera de transacciones)
(la API nunca habla con SMTP)                     5. guarda el resultado y termina
```

- **Outbox transaccional** (`src/modules/notifications/notification-outbox.ts`): las filas se escriben en
  la **misma transacción** que la cita. Si la reserva falla o PostgreSQL la aborta por concurrencia, no
  queda ninguna notificación. Un fallo de SMTP nunca deshace una cita ya guardada.
- **Procesador** (`notification-processor.ts`): una ejecución acotada, sin `setInterval` ni procesos
  permanentes (Hostinger no garantiza workers).
- **Proveedor intercambiable** (`email/email-sender.ts`): las reglas dependen de una interfaz; la
  implementación actual es Nodemailer + SMTP de Hostinger (`email/smtp-email-sender.ts`).
- **No existe ningún endpoint HTTP que envíe correos.** El destinatario siempre sale de la cita:
  `Appointment → Patient → User.email` o `Appointment → psicólogo (User.email)`; nunca de datos
  enviados por el navegador. Cada fila guarda `recipientUserId`; antes de enviar se comprueba que siga
  siendo el paciente o el psicólogo de esa cita (si no, `RECIPIENT_MISMATCH`). Por eso la copia del
  psicólogo no necesitó columnas ni migraciones nuevas.

## 3. Modelo de persistencia

Migración aditiva `apps/api/prisma/migrations/20261025150000_add_email_notifications/` (revisada: sin
`DROP`, `TRUNCATE` ni cambios de datos):

- Tabla `Notification`: `type`, `channel` (EMAIL), `recipientUserId`, `appointmentId`, horario de la cita
  al que se refiere (`appointmentDate`, `startMinute`), `status`, `scheduledFor` (UTC), `attempts`,
  `lastAttemptAt`, `lockedUntil` (reserva del procesador), `acceptedAt`, `providerMessageId`,
  `errorCode` (solo un código), `idempotencyKey` (único), `createdAt`, `updatedAt`.
- Índices: `(status, scheduledFor)` para la cola, `(appointmentId, status)` y `(recipientUserId, acceptedAt)`.
- RLS activado y sin permisos para `anon`/`authenticated` (igual que el resto de tablas).
- `Patient.emailRemindersEnabled` (por defecto `false`) y `Patient.emailRemindersUpdatedAt`.
- **No se guarda el cuerpo de los correos.**

### Estados

| Estado | Significado |
| --- | --- |
| `PENDING` | En cola; se enviará cuando `scheduledFor` llegue |
| `PROCESSING` | Reclamado por una ejecución del cron (con reserva `lockedUntil`) |
| `ACCEPTED` | **El servidor SMTP lo aceptó.** No prueba que llegó al buzón: puede rebotar después |
| `FAILED` | Error permanente o reintentos agotados (ver `errorCode`) |
| `CANCELLED` | Ya no es válido (ver `errorCode`: `STALE`, `SUPERSEDED`, `APPOINTMENT_CANCELLED`, `APPOINTMENT_CLOSED`, `TOO_LATE`, `EXPIRED`, `NO_CONSENT`, `NOT_ALLOWLISTED`, `RECIPIENT_DAILY_LIMIT`…) |

## 4. Reglas antes de enviar

Justo antes de cada envío se lee la cita **actual** (`notification-rules.ts`):

- Confirmación / cambio / recordatorio: la cita debe estar `SCHEDULED`, con el **mismo horario** del
  mensaje y aún no iniciada. Si cambió → `STALE`; si ya empezó → `TOO_LATE`.
- Cancelación: la cita debe estar `CANCELLED`.
- Recordatorio: además exige que el paciente haya **activado** los recordatorios.
- El destinatario debe seguir siendo el dueño de la cita y estar activo.
- Confirmaciones, cambios y cancelaciones con más de `NOTIFICATIONS_MAX_DELAY_HOURS` (24 h) en cola se
  descartan (`EXPIRED`) para no enviar avisos viejos al activar el sistema.

## 5. Idempotencia y concurrencia

- `idempotencyKey` único: `confirmation:<cita>`, `cancellation:<cita>`, `reminder:<cita>:<fecha>:<min>`,
  `reschedule:<cita>:<n>`; las copias del psicólogo llevan el prefijo `psychologist:`. Un reintento SERIALIZABLE de la reserva recalcula la misma clave dentro de
  una transacción nueva, así que no se duplican eventos.
- Volver a un horario anterior reactiva su recordatorio cancelado (no lo duplica).
- Reclamación atómica con `FOR UPDATE SKIP LOCKED`: dos ejecuciones simultáneas toman filas distintas
  (probado).
- Reserva (`lockedUntil`, 15 min) mayor que el tiempo máximo de una ejecución (4 min). Si un cron muere
  a mitad de camino, la siguiente ejecución devuelve la fila a la cola.
- **Caso límite documentado:** si SMTP acepta el correo y justo después falla la escritura en
  PostgreSQL (o Hostinger mata el proceso en ese instante), el mensaje se reenviará cuando venza la
  reserva. La garantía es «al menos una vez», no «exactamente una vez».

## 6. Reintentos y límites

| Situación | Acción |
| --- | --- |
| Error temporal (4xx, timeout, conexión, autenticación) | Reintento a los 5 min, 30 min, 2 h (máx. `NOTIFICATIONS_MAX_ATTEMPTS`, 4) |
| Error permanente (5xx, dirección inválida) | `FAILED` sin reintentos |
| Reintentos agotados | `FAILED` |

- Lote por ejecución: `NOTIFICATIONS_BATCH_SIZE` (20).
- Tope diario del buzón: `NOTIFICATIONS_DAILY_LIMIT` (80, por debajo del límite de Hostinger; ajústalo a
  tu plan). El cron se detiene al alcanzarlo.
- Tope por persona y día: `NOTIFICATIONS_PER_RECIPIENT_DAILY_LIMIT` (10) para pacientes y
  `NOTIFICATIONS_PSYCHOLOGIST_DAILY_LIMIT` (40) para psicólogos, contra abusos.
- Cada agendamiento, cambio o cancelación genera **dos** correos (paciente + psicólogo): calcula el tope
  diario del buzón con eso en mente.
- Tiempo máximo por ejecución: `NOTIFICATIONS_MAX_RUNTIME_SECONDS` (240); lo no enviado vuelve a la cola
  sin gastar intento. Muy por debajo del corte de 30 min del cron de Hostinger.
- Además siguen vigentes los límites de la API: 30 reservas/cambios por hora e IP y máximo 4 citas
  futuras por paciente.

## 7. Privacidad

- Contenido: un texto general, la fecha y la hora (hora de Colombia) y un enlace a
  `https://mentalpieces.site/appointments`.
- **No incluye:** nombre del paciente ni del psicólogo (tampoco en la copia del psicólogo), diagnósticos, síntomas, motivos, notas, datos
  de relaciones clínicas, JWT ni enlaces de acceso.
- Asuntos discretos: «Confirmación de tu cita», «Recordatorio de cita», «Cancelación de tu cita»,
  «Cambio de horario de tu cita».
- Sin imágenes remotas, scripts ni píxeles de seguimiento. Todo dato dinámico se escapa en HTML.
- Los registros del cron muestran solo contadores; las direcciones aparecen enmascaradas
  (`p***@dominio`) y nunca se imprimen contraseñas ni la cadena de conexión.

## 8. Consentimiento

- **Recordatorios (opcionales):** desactivados por defecto. Solo el paciente los activa desde
  **Mi perfil → Recordatorios por correo**. Se guarda el valor y la fecha del último cambio
  (`emailRemindersUpdatedAt`). No hay casillas premarcadas.
- **Confirmación, cambio y cancelación (operativos):** responden a una acción del propio paciente
  sobre su cita y se envían al correo de su cuenta.
- **DECISIÓN PENDIENTE (legal):** confirmar que el aviso de privacidad / términos de registro cubre el
  envío de estos mensajes operativos (Ley 1581 de 2012). Hasta entonces, mantener el envío
  desactivado o limitado a la lista de prueba.
- No se construyó ningún envío comercial ni masivo.

## 9. Configuración

El **API no necesita** estas variables (solo escribe la cola). Van únicamente en el archivo privado
del cron.

| Variable | Secreta | Valor recomendado |
| --- | --- | --- |
| `DATABASE_URL` | **Sí** | La misma de la API (Supabase) |
| `SMTP_HOST` | No | `smtp.hostinger.com` |
| `SMTP_PORT` | No | `465` |
| `SMTP_SECURE` | No | `true` (TLS). Con `587` usar `false`: STARTTLS obligatorio |
| `SMTP_USER` | No | `notificaciones@mentalpieces.site` |
| `SMTP_PASSWORD` | **Sí** | Contraseña del buzón |
| `SMTP_FROM` | No | `notificaciones@mentalpieces.site` |
| `SMTP_FROM_NAME` | No | `Mental Pieces` (por defecto) |
| `NOTIFICATIONS_ENABLED` | No | `false` hasta activar |
| `NOTIFICATIONS_RECIPIENT_ALLOWLIST` | No | Vacío = nadie. `prueba@gmail.com,@example.test` en staging. `*` = todos |
| `NOTIFICATIONS_TIMEZONE` | No | `America/Bogota` (único valor aceptado) |
| `NOTIFICATIONS_TEST_RECIPIENT` | No | Solo para `send-test` |
| `APP_PUBLIC_URL` | No | `https://mentalpieces.site` (por defecto) |
| `NOTIFICATIONS_BATCH_SIZE`, `_DAILY_LIMIT`, `_PER_RECIPIENT_DAILY_LIMIT`, `_PSYCHOLOGIST_DAILY_LIMIT`, `_MAX_ATTEMPTS`, `_MAX_RUNTIME_SECONDS`, `_LEASE_MINUTES`, `_MAX_DELAY_HOURS` | No | 20, 80, 10, 40, 4, 240, 15, 24 |

La certificación TLS nunca se desactiva. Una configuración incompleta hace que el cron termine con un
mensaje que nombra las variables faltantes, sin mostrar valores.

## 10. Hora: UTC y America/Bogota

- Las citas guardan fecha `YYYY-MM-DD` y minutos en hora de Bogotá; `scheduledFor` se guarda en UTC.
- Bogotá es UTC−5 todo el año (sin horario de verano): 09:00 en Bogotá = 14:00 UTC.
- El cron de Hostinger se programa en UTC, pero como corre cada 5 minutos la zona no importa.
- Precisión: los mensajes salen en el **primer ciclo** después de `scheduledFor` (tolerancia ≈ 5 min,
  más si Hostinger retrasa el cron).

## 11. Pruebas

| Suite | Qué cubre |
| --- | --- |
| `src/modules/notifications/*.spec.ts` (unitarias) | Hora Bogotá→UTC, política < 24 h, reglas de envío, configuración segura, SMTP (TLS, errores), plantillas (sin datos clínicos, escapado, UTF-8) |
| `test/integration/notifications.integration-spec.ts` | Outbox con transacciones reales, cancelar/reagendar/cerrar, carreras, procesador: desactivado, envío, no duplicar, concurrencia, reintentos, permanentes, citas cambiadas, consentimiento, lista de prueba, lotes, cuota, tiempo, reservas vencidas |
| `test/integration/security-authorization.integration-spec.ts` | Preferencia (validación y roles) y ausencia de rutas de envío |

Las pruebas nunca envían correos reales (usan un emisor falso) y solo usan PostgreSQL local desechable.
Además, el script compilado se ejecutó desde una copia aislada del build contra un servidor SMTP local
con TLS (sin relé a Internet).

## 12. Puesta en marcha en Hostinger (guía paso a paso)

> Haz los pasos en este orden. **El paso 1 debe ir antes de subir el código**: Hostinger despliega
> `main` automáticamente y, sin la tabla nueva, agendar citas fallaría.

### Paso 1 — Aplicar la migración en Supabase (una vez)

Desde tu computador, en `apps/api`, con la `DATABASE_URL` de Supabase en `apps/api/.env`:

```bash
npx prisma migrate status
npx prisma migrate deploy
```

Debe aplicar solo `20261025150000_add_email_notifications`. Es aditiva (no borra ni modifica datos).

### Paso 2 — Subir el código

Haz commit y push a `main`. Espera a que Hostinger termine el despliegue de la API y de la web.
El envío sigue apagado: solo se acumulan filas en la cola.

### Paso 3 — Archivo privado de variables para el cron

Por SSH (hPanel → Avanzado → Acceso SSH):

```bash
mkdir -p ~/.mentalpieces && chmod 700 ~/.mentalpieces
nano ~/.mentalpieces/notifications.env
chmod 600 ~/.mentalpieces/notifications.env
```

Contenido (completa los dos valores secretos; **no** lo pegues en chats ni en el repositorio):

```text
DATABASE_URL=<la misma URL de Supabase que usa la API>
SMTP_HOST=smtp.hostinger.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=notificaciones@mentalpieces.site
SMTP_PASSWORD=<contraseña del buzón>
SMTP_FROM=notificaciones@mentalpieces.site
NOTIFICATIONS_ENABLED=false
NOTIFICATIONS_TIMEZONE=America/Bogota
NOTIFICATIONS_RECIPIENT_ALLOWLIST=
NOTIFICATIONS_TEST_RECIPIENT=
```

### Paso 4 — Encontrar las rutas reales (una vez)

```bash
ls -d /opt/alt/alt-nodejs22/root/usr/bin/node 2>/dev/null || which node
ls -la ~/domains/api.mentalpieces.site/
```

Busca la carpeta del despliegue **actual** de la API (contiene `dist/src/cli/notifications.js` y
`node_modules`). Si Hostinger usa carpetas por versión (`…/hbuilds/versions/<id>/nodejs`), confirma cuál
es la activa antes de usarla y **revísala después de cada despliegue**. Comprueba:

```bash
cd <carpeta-de-la-api> && test -f dist/src/cli/notifications.js && echo OK
```

### Paso 5 — Probar SMTP sin enviar nada

```bash
cd <carpeta-de-la-api>
<ruta-de-node> --env-file=$HOME/.mentalpieces/notifications.env dist/src/cli/notifications.js verify-smtp
```

Esperado: `SMTP OK: smtp.hostinger.com:465 (TLS), login accepted`.

### Paso 6 — Un único correo de prueba (agrega `--audience psychologist` para ver la versión del psicólogo)

En el archivo privado pon `NOTIFICATIONS_TEST_RECIPIENT=<tu correo autorizado>` y ejecuta:

```bash
<ruta-de-node> --env-file=$HOME/.mentalpieces/notifications.env dist/src/cli/notifications.js send-test --to <tu correo autorizado> --confirm
```

Revisa en Gmail y en el móvil: llegada (y carpeta de spam), tildes y «ñ», diseño, que no haya datos
clínicos. Luego deja `NOTIFICATIONS_TEST_RECIPIENT=` vacío.

### Paso 7 — Crear el cron (hPanel → Avanzado → Cron Jobs → Personalizado)

Frecuencia: cada 5 minutos (`*/5 * * * *`). Comando (una sola línea):

```bash
cd <carpeta-de-la-api> && <ruta-de-node> --env-file=/home/<usuario>/.mentalpieces/notifications.env dist/src/cli/notifications.js process >> /home/<usuario>/logs/mentalpieces-notifications.log 2>&1
```

(Crea antes la carpeta: `mkdir -p ~/logs`.) Con `NOTIFICATIONS_ENABLED=false` cada ejecución escribe
`disabled … nothing sent`: así compruebas que el cron corre sin enviar nada.

### Paso 8 — Activar en staging con cuentas sintéticas

En el archivo privado: `NOTIFICATIONS_ENABLED=true` y
`NOTIFICATIONS_RECIPIENT_ALLOWLIST=<tu correo de prueba>`. Agenda una cita con una cuenta de prueba que
use ese correo. En ≤ 5 min debe llegar la confirmación. Cancela o reagenda y verifica que no llega el
recordatorio viejo.

### Paso 9 — Producción

Solo después de resolver la decisión legal del §8: `NOTIFICATIONS_RECIPIENT_ALLOWLIST=*`.

## 13. Operación diaria

**Revisar los registros:**

```bash
tail -n 50 ~/logs/mentalpieces-notifications.log
```

Cada línea `run {...}` muestra `accepted` (aceptados por SMTP), `retried`, `failed`, `skipped`
(anulados por reglas) y `quotaLeft`.

**Comprobar un envío:** en Supabase → Table editor → `Notification`, filtra por la cita: `status =
ACCEPTED`, `acceptedAt` y `providerMessageId`. Recuerda: ACCEPTED = aceptado por SMTP, no garantiza la
llegada al buzón (un rebote llegaría al buzón `notificaciones@`).

**Detener todos los envíos (inmediato, sin desplegar):** cambia `NOTIFICATIONS_ENABLED=false` en
`~/.mentalpieces/notifications.env`, o pausa/borra el cron en hPanel. La API sigue funcionando y los
mensajes quedan en cola; los operativos viejos se descartarán solos (`EXPIRED`) al reactivar.

## 14. Recuperación ante errores

| Síntoma en el registro | Causa probable | Qué hacer |
| --- | --- | --- |
| `Configuración … inválida: SMTP_PASSWORD` | Falta una variable | Corrige el archivo privado |
| `SMTP error EAUTH` / `SMTP_535` | Usuario o contraseña del buzón | Revisa el buzón en hPanel |
| `SMTP error ESOCKET` / `ETIMEDOUT` | Red o TLS | Reintenta; prueba `verify-smtp` |
| `stoppedBy: "daily_limit"` | Se alcanzó el tope diario | Espera 24 h o sube `NOTIFICATIONS_DAILY_LIMIT` dentro del límite del plan |
| Muchos `FAILED` con `SMTP_550` | Direcciones inexistentes | Revisa correos de pacientes |
| Filas `PROCESSING` antiguas | Un cron fue interrumpido | Se recuperan solas en la siguiente ejecución |
| `Cannot find module` | Ruta del despliegue cambió | Repite el paso 4 y actualiza el cron |

## 15. Riesgos residuales

- No se ha probado todavía el SMTP real ni el cron real de Hostinger.
- La carpeta de despliegue de Hostinger puede cambiar con cada versión: el cron debe apuntar a la actual.
- Entrega «al menos una vez»: posible duplicado en el caso límite del §5.
- ACCEPTED no detecta rebotes (no hay procesamiento de rebotes).
- Revisar SPF, DKIM y DMARC del dominio en hPanel para reducir spam.
- Decisión legal pendiente sobre los mensajes operativos (§8).
