# Portal básico del psicólogo

## Alcance y estado inicial

Implementación exclusivamente frontend sobre la rama `feat/appointments`.
Antes de esta tarea había cambios sin commit en `apps/web/app/dashboard/page.tsx`,
`apps/web/components/app-header.tsx` y `apps/web/lib/api.ts`, además de
`.editorconfig` y `apps/web/app/appointments/` sin seguimiento. Se preservaron.

El backend ya ofrecía disponibilidad propia, agenda propia y `/auth/me`.
No fue necesario modificar sus contratos.

## Flujo y rutas

- Login de PSYCHOLOGIST → `/psychologist/dashboard`.
- Dashboard → `/psychologist/availability`: consultar, crear y eliminar bloques
  semanales; eliminación con confirmación dentro de la página.
- Dashboard → `/psychologist/appointments`: agenda agrupada por fecha, con horas,
  estado y nombre del paciente; sin acciones clínicas.
- `/auth/me` comprueba el rol antes de montar el contenido del portal.
- PATIENT que abre una ruta del psicólogo vuelve a `/dashboard`.
- PSYCHOLOGIST que abre `/dashboard` vuelve a su portal antes de consultar el
  perfil o las citas de paciente.
- ADMIN/STAFF reciben un estado sin acceso y pueden cerrar sesión. No se creó
  un dashboard para esos roles.

Esta comprobación frontend es de navegación. La autorización real sigue en
JwtAuthGuard, RolesGuard y las consultas del backend por identidad del JWT.

## Contratos consumidos

| Método y endpoint | Uso |
| --- | --- |
| POST `/auth/login` (existente) | Redirección a partir de `user.role` |
| GET `/auth/me` | Comprobación del rol autenticado |
| GET `/availability/me` | Lista de bloques activos propios |
| POST `/availability/me` | Solo `dayOfWeek`, `startTime`, `endTime` |
| DELETE `/availability/me/:id` | Eliminación del bloque propio seleccionado |
| GET `/appointments/psychologist/me` | Agenda propia sin parámetros de identidad |

Disponibilidad devuelve `id`, `dayOfWeek`, `startTime`, `endTime`, `isActive`.
DELETE devuelve un mensaje JSON. Agenda devuelve `id`, `appointmentDate`,
`startTime`, `endTime`, `status`, `patient: { id, fullName }`; la UI no muestra IDs.

No se encontraron contratos ambiguos que bloqueen esta tarea. Se interpreta
`appointmentDate` como fecha de calendario `YYYY-MM-DD`, tal como se usa en el
servicio actual; las horas se presentan en America/Bogota sin convertirlas a la
zona local del dispositivo. Un nombre nulo se muestra como «Paciente sin nombre
registrado». Se muestran todos los estados devueltos, sin inventar citas.

## Seguridad y errores

- El cliente nuevo no envía patientId, psychologistId, status ni isActive para
  operaciones propias. La creación selecciona explícitamente los tres campos
  permitidos, incluso si recibe propiedades adicionales en tiempo de ejecución.
- No se añadieron logs, almacenamiento persistente ni datos clínicos.
- El JWT sigue usando el sessionStorage temporal existente. Los nuevos GET usan
  `cache: 'no-store'`.
- 400: detalle de validación del backend, incluyendo arrays de mensajes.
- 409: mensaje de solapamiento; no se duplica la lógica de overlaps en la UI.
- 401: elimina el token de sesión y muestra un enlace para iniciar sesión.
- 403: muestra falta de permisos y bloquea acciones en la vista afectada.
- 404 de eliminación: solicita actualizar la lista.
- Fallos de red/5xx: mensaje de error y reintento de lectura. No se reintentan
  mutaciones automáticamente ni se presentan errores como listas vacías.
- Las mutaciones evitan doble envío local y recargan la lista tras el éxito.
  Esto no resuelve concurrencia entre sesiones ni garantiza exclusión en DB.

## Verificación ejecutada

Desde `apps/web`, en Windows se utilizó `pnpm.cmd` porque PowerShell bloquea
el wrapper `pnpm.ps1`. No se cambió la política del sistema.

| Comprobación | Resultado |
| --- | --- |
| `pnpm.cmd exec tsc --noEmit` | Correcto |
| `pnpm.cmd build` | Correcto; genera las tres rutas |
| `node --test tests/psychologist-api.test.mjs` | 13 pruebas correctas |
| ESLint de archivos nuevos, AppHeader, API y dashboard | Sin errores ni advertencias |
| `pnpm.cmd lint` global | 3 errores y 2 advertencias preexistentes |
| `git diff --check` | Sin errores de espacios |
| Diff de `apps/api` | Vacío |

El primer build restringido falló al descargar Lora y Outfit de Google Fonts.
El segundo build con acceso de red terminó correctamente, sin cambiar fuentes
ni configuración.

Las pruebas nuevas ejecutan el cliente API real con respuestas HTTP simuladas:
contratos propios, campos enviados, nombres nulos, listas vacías, códigos
400/401/403/404/409, respuestas no JSON, ocultación de detalles 5xx y fallos de red.
No son pruebas de integración contra Nest/PostgreSQL ni pruebas visuales.

Lint preexistente:

- `app/appointments/new/page.tsx:70`: setState síncrono en effect.
- `app/appointments/page.tsx:59` y `:87`: setState síncrono en effect.
- `app/appointments/page.tsx:60`: dependencia faltante del effect.
- `app/login/page.tsx`: `MentalPiecesIcon` sin usar.

La herramienta del navegador falló al conectar dos veces con
`missing field sandboxPolicy`. No se pudo realizar revisión visual ni pruebas
interactivas en móvil, tablet o escritorio. No se usaron credenciales reales.

**Hallazgo fuera de alcance:** `apps/api/src/app.controller.spec.ts` contiene un
script que invoca creación de ADMIN y lee configuración, en lugar de una prueba
unitaria aislada. No se ejecutó la suite API para evitar escrituras en DB. El
archivo queda intacto; debe revisarse antes de volver a ejecutar esa suite.

## Aceptación manual pendiente

Usar cuentas de desarrollo existentes y datos de prueba autorizados. No pegar
tokens ni contraseñas en logs, capturas o documentación.

1. PSYCHOLOGIST inicia sesión y llega a su dashboard; no aparecen enlaces de
   paciente ni se consulta `/patients/me`.
2. Abrir disponibilidad, comprobar carga y estado vacío; crear un bloque válido.
3. Intentar un bloque solapado y comprobar HTTP 409 y el mensaje visible.
4. Eliminar el bloque creado, comprobar confirmación, éxito y lista actualizada.
5. Consultar agenda: fechas, horas, los cuatro estados y nombre nulo; comprobar
   que la fecha no cambia según la zona horaria del dispositivo.
6. Con PATIENT, abrir directamente las tres rutas del psicólogo y comprobar
   redirección. Solicitar la agenda del psicólogo al backend con esa sesión y
   comprobar 403. Se verificó el guard por lectura, no por petición autenticada.
7. Con dos psicólogos, comprobar aislamiento de agenda/disponibilidad y 404 al
   intentar eliminar un bloque ajeno.
8. Verificar 401 con sesión vencida, 403, errores de red y reintentos; distinguir
   siempre fallos de carga de listas realmente vacías.
9. Revisar móvil, tablet y escritorio, teclado, foco, botones y textos largos.
10. Confirmar que red/consola no contienen logs de tokens ni información clínica
    y que el flujo previo del paciente continúa funcionando.

## Riesgos y exclusiones

- Persiste el riesgo de reservas concurrentes: la transacción existente con
  consulta de conflicto y creación no constituye por sí sola garantía fuerte.
- Persiste sessionStorage como solución temporal de desarrollo y la dependencia
  de red del build para las fuentes existentes.
- No se modificaron backend, DB, Prisma, migraciones, .env, roles, guards, Auth,
  branding, tipografías, reglas de citas ni el código previo de citas del paciente.
- No se implementaron Clinical Tracking, notas, historias clínicas, estadísticas,
  notificaciones, PWA final ni dashboards administrativos.
- No se ejecutaron commits, push ni merge.

Siguiente paso: ejecutar la aceptación manual con el backend de desarrollo y
el navegador disponibles; revisar por separado el archivo de prueba API y los
errores de lint anteriores.
