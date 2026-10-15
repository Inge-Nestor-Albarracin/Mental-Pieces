# Seguridad — auditoría y endurecimiento (2026-10-15)

## Hallazgos y correcciones

| # | Severidad | Hallazgo | Corrección |
| --- | --- | --- | --- |
| 1 | Crítica | Supabase: las 9 tablas de `public` (incluidas `User.passwordHash` y `ClinicalSessionNote`) tenían RLS desactivado y los roles `anon`/`authenticated` con SELECT/INSERT/UPDATE/DELETE/TRUNCATE. Con la *anon key* del proyecto se podía leer o borrar todo por la Data API (PostgREST) sin pasar por NestJS. | Migración `20261015120000_lock_down_supabase_data_api`: RLS activado sin políticas, permisos revocados y privilegios por defecto retirados para tablas futuras. Prisma usa el rol `postgres` (propietario, BYPASSRLS) y no se ve afectado. Verificado: como `anon`, `SELECT` sobre `User` → *permission denied*. |
| 2 | Crítica/Alta | Dependencias vulnerables en runtime: `proxy-addr` (crítica), `multer`, `qs`, `body-parser`; Next 16.2.6 con avisos críticos/altos. | Nest 11.2.7, Prisma 7.10, `overrides` de pnpm para transitivas; Next 16.3.8 (versión parcheada con ≥ 2 semanas). `pnpm audit --prod`: web 0, API 1 (ver residuales). |
| 3 | Alta | Sin límite de peticiones: fuerza bruta de contraseñas, registro masivo, consumo de CPU (bcrypt coste 12) y de consultas costosas. | `@nestjs/throttler` global por IP (120/min) y límites estrictos: login 20/15 min, registro 5/h, escritura de citas 30/h, alertas 20/min. Bloqueo por cuenta: 5 fallos → 15 min, también para correos inexistentes (sin enumeración). |
| 4 | Media | Enumeración de cuentas por tiempo: sin usuario no se ejecutaba bcrypt. | Se compara siempre contra un hash de coste 12. |
| 5 | Media | Sin cabeceras de seguridad en API ni web. | API: `helmet`. Web: CSP, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP y HSTS en producción; sin `X-Powered-By`. |
| 6 | Media | Un paciente podía reservar sin límite y bloquear la agenda de un psicólogo. | Máximo 4 citas futuras programadas por paciente (`MAX_UPCOMING_APPOINTMENTS_PER_PATIENT`). |
| 7 | Baja | CORS fijo a `localhost`; algoritmo JWT no fijado; body sin límite explícito; registro concurrente → 500. | `CORS_ORIGINS` por entorno; JWT firmado y verificado solo con HS256 (rechaza `alg: none` y HS512); JSON ≤ 100 kB (413); P2002 → 409. |

## Configuración nueva (opcional)

- `CORS_ORIGINS`: orígenes permitidos separados por coma (por defecto `http://localhost:3000`).
- `TRUST_PROXY`: número de proxies delante del API (por defecto 0). Configúralo al desplegar detrás de
  un balanceador para que los límites usen la IP real; no lo actives sin proxy (X-Forwarded-For se puede falsificar).

## Riesgos residuales

- **Límites en memoria:** valen por instancia. En serverless o con varias instancias, usar almacenamiento
  compartido (Redis/Upstash) para el throttler y el bloqueo por cuenta.
- **JWT en `sessionStorage`:** un XSS podría robar la sesión (mitigado por CSP). Migrar a cookie HttpOnly antes de producción.
- **CSP con `'unsafe-inline'` en scripts:** requerido por Next sin nonces; endurecer con middleware de nonce.
- **Desactivar cuentas:** el token sigue válido hasta 15 min (las rutas clínicas sí revisan la base).
- **`deepmerge-ts` (alta):** solo en el CLI de Prisma (desarrollo); corregirlo exige Prisma 8.
- **Supabase:** la clave `service_role` y la cadena `DATABASE_URL` dan acceso total; nunca exponerlas al cliente.
  Rotar la contraseña de la base si se sospecha que se compartió.
- **Concurrencia de reservas:** sigue sin garantía a nivel de base de datos.
