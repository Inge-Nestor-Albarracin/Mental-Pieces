# Verificación: correos, notificaciones push y seguridad (Supabase y software)

Fecha: 3 de noviembre de 2026.
Alcance:
- diagnóstico del envío de correos;
- prueba del canal push;
- auditoría de seguridad de Supabase (solo lectura), de producción (sondas sin credenciales, una petición por prueba, sin carga) y del código y las dependencias.

Reglas seguidas:
- no se leyeron datos de pacientes, notas clínicas ni secretos;
- en Supabase solo se hicieron consultas de catálogo y conteos agregados, dentro de transacciones `READ ONLY`.

## 1. Resumen

| # | Hallazgo | Severidad | Estado |
|---|---|---|---|
| 1 | **Los correos nunca se enviaron**: el cron de Hostinger no recibe las variables de entorno de la app | Alta (funcional) | Corregido en código (pendiente de desplegar y de cambiar el cron) |
| 2 | **Conexión a Supabase sin cifrar**: `DATABASE_URL` sin `sslmode` y Supabase acepta texto plano | Alta (seguridad) | Corregido en código: TLS obligatorio (pendiente de desplegar) |
| 3 | Push: 0 suscripciones en producción; falta confirmar que `PUSH_ENABLED` y las claves VAPID estén configuradas | Media | Requiere tu verificación |
| 4 | Dependencia `qs` con aviso moderado (DoS en `stringify`, no usado por la API) | Baja | Corregido (`qs` 6.17.1) |
| 5 | `deepmerge-ts` 7.x (aviso alto) fijada por Prisma; solo procesa la configuración de la CLI | Baja | Riesgo aceptado y documentado |
| 6 | La app se conecta como `postgres` (con `BYPASSRLS`); el RLS protege solo frente a la Data API | Media | Recomendación |
| 7 | Las funciones de trigger son ejecutables por `anon` y `authenticated` (no son invocables por RPC) | Informativa | Recomendación |
| 8 | Fallos TLS intermitentes al llamar a `api.mentalpieces.site` desde el cliente TLS de Windows (schannel) | Informativa | Sin impacto en navegadores |

## 2. Correos: causa raíz

### Evidencia (consulta agregada de la tabla `Notification`, 3-11-2026)

| Canal | Estado | Código | Filas | Último intento |
|---|---|---|---|---|
| EMAIL | PENDING | — | 8 | **nunca** |
| EMAIL | CANCELLED | APPOINTMENT_CANCELLED | 8 | nunca |
| EMAIL | CANCELLED | APPOINTMENT_CLOSED | 4 | nunca |

- Se encolaron 20 correos (17 el 26-oct y 3 el 31-oct): el outbox funciona.
- **Ninguno se intentó** (`lastAttemptAt` vacío y `attempts = 0` en todos). Hay 8 pendientes vencidos desde el 26-oct.
- El procesador marca `PROCESSING` y suma intentos **antes** de llamar a SMTP. Por tanto, el fallo no es SMTP: el procesador nunca llegó a tomar mensajes.

### Causa

Los cron jobs de Hostinger **no heredan las variables de entorno de la aplicación Node.js**, según la guía y la documentación de Hostinger:
- https://www.hostinger.com/support/?p=21119
- https://docs.hostinger.com/node.js/environment-variables

La CLI `notifications.js process` arrancaba sin `NOTIFICATIONS_ENABLED`, lo interpretaba como desactivado, escribía «disabled» y terminaba sin tocar la cola. A eso se sumaba la programación observada, `*/5 0 * * *`, que solo corre de 00:00 a 00:55 UTC.

### Corrección

Se usa la alternativa que propone Hostinger: el cron llama por HTTP a la propia API, que sí tiene las variables.

- **Nuevo endpoint `POST /internal/notifications/run`.**
  - **Credencial:** cabecera `X-Cron-Secret`, comparada en tiempo constante con `NOTIFICATIONS_CRON_SECRET` (mínimo 32 caracteres). No usa JWT.
  - **Sin secreto configurado:** responde **404**, como si la ruta no existiera.
  - **Respuesta:** **202** inmediato. El procesamiento (correo y push) sigue en segundo plano con los mismos límites de tiempo, lote y cuota, sin solaparse.
  - **Límite:** 30 llamadas por hora.
- **Pruebas e2e:** 5, con resultado 5/5. Cubren 404 sin secreto, secreto corto ignorado, 401 con secreto ausente o incorrecto (o enviado como Bearer), 202 con el correcto y que solo se acepta POST.
- **Mensajes antiguos:** los 8 pendientes **no** se enviarán tarde. Las confirmaciones de hace más de 24 h se descartan como `EXPIRED`, y los recordatorios de citas pasadas como `TOO_LATE`.

Además, los 7 pacientes tienen desactivado el recordatorio por correo. Los recordatorios son opcionales, así que nunca habrá recordatorios por correo hasta que algún paciente los active.

## 3. Notificaciones push: pruebas

| Prueba | Resultado |
|---|---|
| Envío real con `WebPushSender` (librería `web-push`) contra un servicio push simulado HTTPS en local; el «dispositivo» descifra con sus propias claves | **21/21** |
| Service worker (`public/sw.js`) ejecutado con un entorno de navegador simulado | **6/6** |
| Unitarias, e2e e integración del canal push (ya existentes) | Incluidas en la sección 6 |

Qué se comprobó en el envío real:
- **Cifrado:** cifrado `aes128gcm` (RFC 8291). El cuerpo no contiene texto en claro y el dispositivo lo descifra exactamente.
- **Contenido:** el mensaje no incluye nombres.
- **Cabeceras:** TTL de 12 h, Urgency `high` y Topic válido.
- **VAPID (RFC 8292):** JWT ES256 con la firma verificada, `aud` igual al origen del servicio push y `sub` igual al contacto configurado. Expira en 24 h o menos y la clave privada nunca viaja.
- **Respuestas del servicio:** 404/410 borran la suscripción; 429/503 y los errores de red se reintentan; 400 es un fallo definitivo.

Qué se comprobó en el service worker:
- muestra título, texto, icono y etiqueta;
- con un payload ilegible, muestra un aviso genérico;
- las URL externas, `//` y `javascript:` se reemplazan por `/`;
- al tocar la notificación, abre la app o enfoca la ventana ya abierta;
- con datos manipulados, nunca abre otro origen.

**En producción:**
- las rutas `/push/*` y `/staff-desk/*` están desplegadas (responden 401 sin token);
- hay **0 suscripciones**, así que nadie ha activado las notificaciones todavía, o push no está habilitado en Hostinger;
- no se pudo probar la entrega en un dispositivo real: el navegador integrado de la herramienta bloquea service workers y notificaciones, y no se usan credenciales reales.

Prueba manual pendiente en la sección 7.

## 4. Supabase (consultas de catálogo, solo lectura)

| Control | Resultado |
|---|---|
| RLS activo | **13/13 tablas** de `public` (incluida `_prisma_migrations`), sin políticas: la Data API no puede leer ni escribir. |
| Privilegios de `anon`/`authenticated` sobre tablas, vistas y secuencias | **Ninguno**. |
| Vistas en `public` | Ninguna. |
| Storage | Sin buckets. |
| Supabase Auth | 0 cuentas (la app usa su propia autenticación). |
| Privilegios por defecto de objetos futuros creados por `postgres` | Solo `postgres` y `service_role`; las migraciones no conceden acceso a `anon`. |
| Integridad | Triggers `LegalDocument_immutable` y `DataProcessingConsent_guard`; `CHECK` en `LegalDocument` y `PushSubscription`. |
| Extensiones | Las estándar de Supabase (`pgcrypto`, `uuid-ossp`, `pg_stat_statements`, `vault`). |
| **TLS** | **Supabase acepta conexiones sin cifrar** y `node-postgres` no cifra si no se le indica. Ver hallazgo 2. |
| Rol de la app | `postgres`: no es superusuario, pero tiene `BYPASSRLS` y permisos de DDL. Ver hallazgo 6. |
| Funciones de trigger | `mp_legal_document_immutable` y `mp_data_consent_guard` son ejecutables por `anon` y `authenticated` (no son `SECURITY DEFINER` y PostgREST no expone funciones de trigger). Ver hallazgo 7. |

### Corrección del hallazgo 2 (TLS)

Nuevo `src/database/database-ssl.ts`, usado por `PrismaService` (API, CLI y pruebas):
- **Bases remotas:** usan siempre TLS. El parámetro `sslmode` de la URL se ignora, así que tampoco se puede desactivar con `sslmode=disable`.
- **Con `DATABASE_SSL_CA`** (certificado de Supabase en PEM): se verifica además el certificado del servidor, lo que protege también contra suplantación.
- **Bases locales de prueba:** sin TLS.
- **Pruebas:** 5 unitarias. Verificado contra Supabase: la conexión con TLS funciona y la verificación con CA públicas falla (`SELF_SIGNED_CERT_IN_CHAIN`), porque el pooler usa la CA propia de Supabase. Por eso conviene configurar `DATABASE_SSL_CA`.

## 5. Producción y software

| Control | Resultado |
|---|---|
| JWT `alg=none` o firma falsa con rol ADMIN | 401 |
| Endpoints clínicos y de usuarios sin token | 401 |
| Registro con un campo `role: ADMIN` adicional | 400 (lista blanca de campos) |
| CORS desde un origen ajeno | Sin `Access-Control-Allow-Origin` |
| CORS desde `mentalpieces.site` | Permitido |
| Cabeceras de la web | HSTS de 2 años, CSP, `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy`, COOP; sin `X-Powered-By` |
| Cabeceras de la API | Helmet: HSTS, CSP, `nosniff`, `SAMEORIGIN`, `no-referrer`; sin `X-Powered-By` |
| Archivos sensibles (`/.env`, `/.git/config`, `package.json`, `schema.prisma`, mapas de código) | 403 o 404 |
| Certificados | Let's Encrypt, TLS 1.3, válidos hasta el 23-01-2027 (web y API) |
| Secretos en el repositorio y en todo el historial | Ninguno real; solo marcadores de ejemplo. `.env` está ignorado. |
| SQL crudo inseguro (`$queryRawUnsafe`) y HTML inyectado (`dangerouslySetInnerHTML`) | Ninguno |
| Rutas sin JWT | Solo las previstas: registro, login, `/auth/me` (valida el token), política, raíz y el disparador del cron (con secreto) |

Resultado de `pnpm audit`:

| Paquete | Ámbito | Severidad | Situación |
|---|---|---|---|
| `qs` < 6.16.1 | API, producción | Moderada | Corregido: override `^6.16.1`, instalada la 6.17.1 |
| `deepmerge-ts` < 8 | API, producción (CLI de Prisma) | Alta | Riesgo aceptado: Prisma fija la 7.1.5 y solo combina configuración de confianza al ejecutar la CLI; forzar la 8 (cambio mayor) puede romper Prisma |
| `glob`, `minimatch`, `deepmerge` | Desarrollo (jest, eslint, nest-cli) | Baja o moderada | No se despliegan a producción |
| Web, producción | — | — | **Sin vulnerabilidades** |

**Fallos TLS intermitentes (hallazgo 8).** Desde Windows, `curl` (schannel) falló el handshake con `api.mentalpieces.site` en 9 de 10 intentos. Con OpenSSL (Node) funcionó 6/6, y con el dominio web 5/5. Los certificados son correctos. Es una incompatibilidad del cliente de Windows con la configuración TLS de LiteSpeed en ese subdominio, y no afecta a Chrome, Edge, Safari ni Firefox. Si algún usuario reporta errores de conexión, revisar la configuración TLS del subdominio en Hostinger.

## 6. Pruebas tras los cambios

| Suite | Resultado |
|---|---|
| Unitarias API | 120/120 (14 suites) |
| E2E API | 200/200 (9 suites) |
| Integración (PostgreSQL local desechable) | 76/76 (5 suites) |
| Web | 88/88 |
| Envío push real (local) | 21/21 |
| Service worker | 6/6 |

El lint de los archivos modificados está limpio. Los 407 avisos de `eslint` en todo `src/` y `test/` son formato de archivos antiguos, anteriores a esta revisión.

## 7. Lo que debes hacer (en este orden)

1. **Subir el código** (commit y push). Incluye el disparador HTTP del cron, el TLS obligatorio hacia Supabase y `qs` actualizado.
2. **Añadir en Hostinger** (aplicación de la API) y volver a desplegar:
   - `NOTIFICATIONS_CRON_SECRET`: 32 caracteres aleatorios o más. Puedes generarlo con `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`;
   - `NOTIFICATIONS_ENABLED=true` y las variables `SMTP_*`, si no están ya **en la aplicación**;
   - `PUSH_ENABLED=true`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT` (`docs/notificaciones-push-y-recepcion.md`);
   - opcional, recomendado: `DATABASE_SSL_CA` con el certificado de Supabase (Project Settings → Database → SSL Configuration → Download certificate). Se puede pegar con los saltos de línea escritos como `\n`.
3. **Reemplazar el cron** por uno cada 5 minutos (`*/5 * * * *`) con el comando:

   ```
   curl -fsS -X POST -H "X-Cron-Secret: <el secreto>" https://api.mentalpieces.site/internal/notifications/run
   ```

   Respuestas esperadas:
   - **202:** funciona;
   - **401:** el secreto no coincide;
   - **404:** falta la variable o no se ha redesplegado.
4. **En Supabase:** activar **Enforce SSL on incoming connections** (Database → Settings → SSL Configuration). Haz esto **después** del paso 1, para que la app ya use TLS.
5. **Probar push en un dispositivo real:**
   - entra en Chrome o en el teléfono (en iPhone, con la app instalada) y pulsa «Activar»; debe llegar «Notificaciones activadas»;
   - agenda una cita con un paciente de prueba; el staff debe recibir «Nueva cita agendada» en segundos.
6. **Probar el correo:** agenda una cita de prueba con un correo propio. En 5 minutos o menos debe llegar la confirmación. Si no llega, avísame y reviso la cola.

## 8. Recomendaciones

- **Rol mínimo para la app (hallazgo 6).** Crear un rol de base de datos solo con `SELECT/INSERT/UPDATE/DELETE` sobre las tablas de `public` y usarlo en `DATABASE_URL`. Las migraciones seguirían con `postgres`. Así, una inyección en la app no podría borrar tablas ni cambiar el esquema.
- **Funciones de trigger (hallazgo 7).** `REVOKE EXECUTE ON FUNCTION mp_legal_document_immutable(), mp_data_consent_guard() FROM PUBLIC, anon, authenticated;` en una migración futura (no se aplicó: es un cambio de esquema).
- **Data API.** Como la app no usa la Data API de Supabase, se puede desactivar en Project Settings → API. Hoy ya está bloqueada por RLS y por la ausencia de privilegios, pero así se elimina la superficie por completo.
