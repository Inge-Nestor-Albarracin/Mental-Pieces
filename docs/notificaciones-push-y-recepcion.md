# Notificaciones push y portal de recepción (Staff)

Fecha: 30 de octubre de 2026. Estado: **implementado y probado en local; migración aplicada en Supabase el 30-10-2026; código no desplegado**. Faltan las claves en Hostinger y subir el código (sección 5).

## 1. Qué se agregó

| Funcionalidad | Detalle |
|---|---|
| Notificaciones push en la PWA | Pacientes, psicólogos, administradores y staff ven en su portal un aviso «Activa las notificaciones». El permiso se pide **solo al pulsar «Activar»**, porque los navegadores bloquean las solicitudes automáticas. |
| Avisos para paciente y psicólogo | Confirmación, reprogramación y cancelación de citas, y recordatorio 24 h antes (solo paciente). Son los mismos eventos que ya se enviaban por correo. |
| Aviso al staff | Cuando se agenda una cita, cada cuenta STAFF activa con notificaciones recibe «Nueva cita agendada». Si la cita la agendó un miembro del staff, él no recibe su propio aviso. |
| Portal Staff (`/staff/dashboard`) | Agenda de **citas próximas de cada psicólogo** (7, 14 o 30 días), con filtro por psicólogo. Muestra hora, paciente y número de registro, y marca las citas «Agendadas por recepción». |
| Agendar para un paciente (`/staff/appointments/new`) | Búsqueda por nombre, número de registro, correo o teléfono. Después se elige psicólogo, fecha y hora. Si un paciente no puede agendar, se indica el motivo: perfil incompleto, sin aceptar la política o menor de edad. |

Antes, el rol STAFF no tenía portal: al iniciar sesión veía «Sin acceso».

## 2. Diseño

### Push

- **Outbox.** Cada correo de cita tiene ahora una «gemela» con canal `PUSH`. Se crea en la misma transacción que la cita y solo si el destinatario tiene al menos una suscripción. La alerta al staff es un tipo nuevo, `STAFF_NEW_BOOKING`, que solo existe como push.
- **Envío inmediato.** Al confirmarse la transacción, la API ejecuta en segundo plano un procesamiento de la cola push (`PushDispatcher`). Así la alerta llega en segundos sin retrasar ni hacer fallar la petición.
- **Respaldo por cron.** El mismo cron de correos (`notifications.js process`) procesa también la cola push: reintentos, recordatorios de 24 h y lo que no se haya enviado por una caída.
- **Colas separadas.** `NotificationQueue` filtra por canal, de modo que el procesador de correo nunca toma mensajes push ni al revés. Los límites diarios de correo cuentan solo correos.
- **Mismas reglas de vigencia que el correo.** Antes de enviar se vuelve a leer la cita. Si se canceló o cambió, el aviso se descarta (`STALE`). Tampoco se envían avisos tardíos (`EXPIRED`) ni a cuentas inactivas.
- **Varios dispositivos.** Se envía a cada dispositivo del usuario (máximo 5). Si el servicio push responde 404/410, la suscripción se borra.

### Privacidad y seguridad

- **Contenido mínimo.** Un push se puede leer con la pantalla bloqueada, así que solo contiene un texto general, la fecha y la hora. No incluye nombres de paciente ni de psicólogo, ni motivos o contenido clínico; igual que los correos.
- **Protección contra SSRF.** Solo se aceptan suscripciones de los servicios push de los navegadores: `fcm.googleapis.com`, Mozilla, `web.push.apple.com` y Windows. Cualquier otra URL se rechaza; de lo contrario, un usuario podría hacer que el servidor llame a hosts internos.
- **Cierre de sesión.** Al salir se borra la suscripción del dispositivo, para que en un equipo compartido no lleguen avisos de la cuenta anterior. Si otra cuenta inicia sesión en el mismo navegador, la suscripción pasa a esa cuenta.
- **Validación y límites.** La tabla `PushSubscription` tiene RLS activo, sin acceso desde la API de datos de Supabase, y un `CHECK` sobre el formato de las claves. Los endpoints `/push/*` y `/staff-desk/*` tienen límite de peticiones.
- **Rol verificado en la base de datos.** El portal Staff comprueba en la base que la cuenta sigue siendo STAFF y está activa; no confía solo en el token. Solo ve datos administrativos, nunca notas ni alertas clínicas.
- **Misma lógica de reserva.** El staff agenda con exactamente la misma transacción que el paciente (SERIALIZABLE, cruces, límite de 4 citas, perfil completo, política aceptada, mayoría de edad). La columna `Appointment.bookedByUserId` registra quién agendó.

## 3. Cambios en la base de datos

Migración `20261030160000_add_push_and_staff_booking`. Solo añade elementos; no modifica datos existentes:

- valor `STAFF_NEW_BOOKING` en `NotificationType` y valor `PUSH` en `NotificationChannel`;
- columna opcional `Appointment.bookedByUserId`;
- tabla `PushSubscription` (borrado en cascada con el usuario, RLS y `CHECK` de claves).

Aplicada **solo** en la base local desechable. Después, `prisma migrate diff` quedó vacío.

## 4. Pruebas

| Tipo | Resultado |
|---|---|
| Unitarias API (Jest) | 115/115, incluidas 26 nuevas de push: configuración, protección SSRF, mensajes sin nombres, clasificación de errores y reglas de entrega. |
| E2E API (Jest + Supertest) | 195/195, incluidas 18 nuevas: roles del portal Staff, validación y SSRF en `/push`. |
| Integración (PostgreSQL local desechable) | 76/76, incluidas 8 nuevas. Cubren la reserva por staff, el aviso a los demás staff, que no se dupliquen citas, los mensajes para recepción, el envío a varios dispositivos, el borrado de suscripciones vencidas y el descarte de alertas obsoletas. |
| Web (`node:test`) | 88/88, incluidas 8 nuevas. |
| Navegador (build de producción local) | Inicio de sesión como staff, agenda, búsqueda (el paciente bloqueado muestra el motivo), reserva completa y vista a 360 px sin desplazamiento horizontal. |

**No verificado:** la recepción real de un push en un dispositivo. El panel de navegador integrado de la herramienta bloquea service workers y notificaciones. Hay que probarlo en Chrome o en el teléfono después de desplegar (sección 5, paso 5).

## 5. Pasos para desplegar (en este orden)

1. **Generar las claves VAPID** una sola vez, desde `apps/api`:

   ```bash
   npx web-push generate-vapid-keys
   ```

   Guarda la clave privada como un secreto. No la subas al repositorio y no la pongas en la web.
2. **Configurar las variables en Hostinger**, tanto en la aplicación de la **API** como en el **entorno del cron**:

   ```
   PUSH_ENABLED=true
   VAPID_PUBLIC_KEY=<clave pública>
   VAPID_PRIVATE_KEY=<clave privada>
   VAPID_SUBJECT=mailto:paulasarmientopsicologia@gmail.com
   ```

   Opcionales: `PUSH_TTL_HOURS` (12), `PUSH_MAX_ATTEMPTS` (4) y `PUSH_MAX_DELAY_HOURS` (12).
3. **Aplicar la migración en Supabase.** Requiere tu autorización. Desde `apps/api`:

   ```bash
   pnpm exec prisma migrate status
   ```

   ```bash
   pnpm exec prisma migrate deploy
   ```

   Solo debe aplicar `20261030160000_add_push_and_staff_booking`.
4. **Subir el código** (commit y push a `main`). Hostinger reconstruye la API y la web. Hay una dependencia nueva en la API: `web-push` 3.6.7.
5. **Verificar:**
   - entrar como staff en Chrome y pulsar «Activar» debe mostrar una notificación de prueba;
   - agendar una cita como paciente de prueba debe hacer llegar «Nueva cita agendada» al staff en segundos;
   - en iPhone/iPad, push solo funciona con la app instalada en la pantalla de inicio (iOS 16.4 o posterior). El aviso lo explica.
6. **Revisar el cron.** Debe ejecutarse cada 5 minutos (`*/5 * * * *`); en Hostinger se había visto configurado como `*/5 0 * * *`.

Sin `PUSH_ENABLED=true`, todo sigue funcionando como antes: no se muestra el aviso y no se crean filas push.

## 6. Archivos principales

- API:
  - `src/modules/push/` (endpoints `/push/*` y `PushDispatcher`);
  - `src/modules/notifications/push/` (configuración, emisor, mensajes, lista de servicios permitidos y procesador);
  - `src/modules/notifications/notification-queue.ts`;
  - `src/modules/appointments/staff-desk.*` (endpoints `/staff-desk/*`).
- Web:
  - `public/sw.js` (eventos `push` y `notificationclick`);
  - `lib/push.ts`, `lib/push-keys.ts`, `components/push-notifications.tsx`;
  - `app/staff/*`, `lib/staff-desk.ts`, `components/booking-steps.tsx`.

## 7. Fuera de alcance

- El staff todavía no puede **cancelar ni reprogramar** citas de pacientes (RF-12 y RF-13 siguen parciales).
- El staff no recibe avisos de cancelaciones ni de reprogramaciones; solo de citas nuevas, como se pidió.
- El administrador puede activar las notificaciones, pero todavía no hay eventos dirigidos a él.
