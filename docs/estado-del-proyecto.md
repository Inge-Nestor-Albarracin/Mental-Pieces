# Mental Pieces — Estado del proyecto

> Documento vivo. Describe el estado **real y verificado** del sistema en la fecha indicada. Se actualiza cada vez que se avanza (ver la sección 10, «Cómo mantener este documento»).

| Dato | Valor |
|---|---|
| Última actualización | 30 de octubre de 2026 |
| Último commit en `main` | `fd3f9af` — «Politica de datos de registro añadadida» (sincronizado con `origin/main`) |
| Producción | Web: `https://mentalpieces.site` · API: `https://api.mentalpieces.site` |
| Base de datos | PostgreSQL en Supabase, 10 de 10 migraciones aplicadas |
| Pruebas unitarias | API: 87 de 87 correctas · Web: 80 de 80 correctas (ejecutadas el 29-10-2026) |

---

## 1. Resumen

Mental Pieces es una aplicación web progresiva (PWA) para la gestión de citas y el seguimiento psicológico. Tiene tres portales: paciente, psicólogo y administrador.

Están en funcionamiento:

- la autenticación por roles;
- la disponibilidad semanal de los psicólogos;
- el agendamiento, la reprogramación y la cancelación de citas con control de concurrencia;
- el registro de asistencia;
- las notas clínicas con auditoría;
- las alertas de seguimiento;
- las notificaciones por correo.

**Política de datos:** desde el 30-10-2026 está publicada la versión 1.0 de la Política de Tratamiento de Datos Personales (`docs/legal/politica-tratamiento-datos-v1.0.txt`). Con eso se abren el registro de pacientes y las reservas. Los pacientes que ya tenían cuenta deben aceptarla en `/autorizacion-de-datos` antes de reservar.

---

## 2. Estado del despliegue

| Componente | Estado | Detalle |
|---|---|---|
| Aplicación web (Next.js) | En producción | Hostinger Business, Node.js 22, despliegue automático desde `main`. |
| API REST (NestJS) | En producción | Hostinger Business, Node.js 22, despliegue automático desde `main`. |
| Base de datos | Al día | Supabase (pooler de sesión, puerto 5432). Las 10 migraciones están aplicadas; la última se aplicó el 30-10-2026. |
| Procesador de notificaciones | Configurar y verificar | Cron de Hostinger con el comando `src/cli/notifications.js process`. La programación correcta es `*/5 * * * *`; la que se vio configurada era `*/5 0 * * *`, que solo corre de 00:00 a 00:59. |
| Política de datos | Publicada | Versión 1.0, publicada el 30-10-2026 (SHA-256 `56ddc26e…74a5feb8`). Responsable: MENTAL PIECES BY PAULA SARMIENTO S A S, NIT 901911280. |
| Texto de la casilla de autorización | Pendiente de despliegue | Actualizado en `/register` y `/autorizacion-de-datos` para nombrar al responsable; falta commit y push. |
| Secretos | Pendiente de rotación | Rotar `JWT_SECRET` y la contraseña SMTP, que quedaron visibles en una captura de pantalla. |

---

## 3. Estado de los requisitos funcionales (Anexo A)

Estados: **Completo** · **Parcial** · **No implementado** · **Bloqueado** (implementado, pero no operativo en producción).

| Código | Requisito | Estado | Observación |
|---|---|---|---|
| RF-01 | Registro de pacientes | Completo | Con autorización de datos (política v1.0 publicada el 30-10-2026). |
| RF-02 | Inicio de sesión | Completo | bcrypt; bloqueo tras 5 intentos fallidos en 15 minutos; JWT con vigencia de 15 minutos. |
| RF-03 | Cierre de sesión | Completo | Se elimina el token del navegador. El token no se revoca en el servidor; caduca a los 15 minutos. |
| RF-04 | Control de acceso por rol | Completo | `JwtAuthGuard` y `RolesGuard` en cada endpoint. |
| RF-05 | Consultar y actualizar perfil | Parcial | El paciente sí puede. El psicólogo y el administrador no tienen pantalla para editar su perfil. |
| RF-06 | Crear cuentas internas | Completo | El administrador crea cuentas de psicólogo y de personal administrativo. |
| RF-07 | Gestionar cuentas internas | Parcial | Solo crear y consultar. Falta actualizar, cambiar el rol y activar o desactivar. |
| RF-08 | Horarios y bloqueos de disponibilidad | Parcial | Hay horarios semanales con validación de superposición. Faltan los bloqueos por fecha (vacaciones, ausencias). Solo los gestiona el psicólogo. |
| RF-09 | Consultar disponibilidad | Completo | Solo muestra espacios futuros, habilitados y libres. |
| RF-10 | Programar cita | Completo* | El paciente y, desde el portal Staff, el personal administrativo (para otro paciente, con las mismas reglas). *Pendiente de despliegue. |
| RF-11 | Consultar citas según el rol | Completo* | Paciente, psicólogo y Staff (citas próximas de cada psicólogo). *Pendiente de despliegue. |
| RF-12 | Cancelar cita | Parcial | El paciente sí puede; el personal administrativo no. |
| RF-13 | Reprogramar cita | Parcial | El paciente sí puede; el personal administrativo no. |
| RF-14 | Evitar doble asignación | Completo | Transacción SERIALIZABLE con reintentos. Probado con concurrencia (`docs/audits/2026-10-29-pruebas-concurrencia.md`). |
| RF-15 | Estado y asistencia | Completo | El psicólogo marca «Realizada» o «No asistió» después de la hora de finalización. |
| RF-16 | Registrar en lista de espera | No implementado | — |
| RF-17 | Identificar pacientes de la lista de espera | No implementado | — |
| RF-18 | Notificaciones | Completo | Correo: confirmación, reprogramación, cancelación y recordatorio de 24 h (depende del cron). Push en la PWA para todos los roles, con aviso al staff por cada cita nueva: implementado, pendiente de despliegue. |
| RF-19 | Nota previa del paciente | No implementado | — |
| RF-20 | Notas de evolución | Completo | Requieren una relación clínica activa; quedan registradas en la auditoría. |
| RF-21 | Historial de seguimiento | Completo | Historial paginado, visible solo para el psicólogo asignado. |
| RF-22 | Alertas de inactividad | Completo | Reglas: 14 días sin primera sesión; más de 30 días sin sesión (alta desde 60); 2 inasistencias seguidas. |
| RF-23 | Estadísticas administrativas | No implementado | — |

**Totales:** 14 completos (2 pendientes de despliegue) · 5 parciales · 4 no implementados · 0 bloqueados (23 en total).

## 4. Estado de los requisitos no funcionales

| Código | Requisito | Estado | Evidencia |
|---|---|---|---|
| RNF01 | Notas accesibles solo al psicólogo autor o asignado | Completo | `ClinicalAccessService`; la vista administrativa no muestra contenido clínico. |
| RNF02 | Contraseñas cifradas | Completo | bcrypt con costo 12. |
| RNF03 | Auditoría | Completo | Tabla `AuditLog` para las acciones clínicas. |
| RNF04 | Transacciones atómicas | Completo | Transacciones SERIALIZABLE y patrón *outbox* para los correos. |
| RNF05 | 95 % de respuestas en menos de 2 s con 20 usuarios | Verificado en entorno de prueba | p95 ≤ 119 ms con 25 peticiones simultáneas por ruta, en un portátil con la base local (`docs/audits/2026-10-25-auditoria-seguridad-concurrencia-rendimiento.md`). No se hizo prueba de carga contra producción. |
| RNF06 | Interfaz en 360 y 1366 px | Completo | Diseño responsivo; pendiente la evidencia con capturas para la tesis. |

---

## 5. Base de datos (migraciones)

| Migración | Contenido | Supabase |
|---|---|---|
| `20260610023520_init_users_patients_staff` | Usuarios, pacientes y personal | Aplicada |
| `20260715014318_rename_password_to_password_hash` | Renombra la columna de contraseña | Aplicada |
| `20260922181502_add_psychologist_availability` | Disponibilidad semanal | Aplicada |
| `20260927213426_add_appointments` | Citas | Aplicada |
| `20260928000523_add_clinical_tracking` | Relaciones clínicas, notas y auditoría | Aplicada |
| `20260930203629_link_clinical_notes_to_appointments` | Nota vinculada a la cita | Aplicada |
| `20261015120000_lock_down_supabase_data_api` | RLS y bloqueo de la API de datos de Supabase | Aplicada |
| `20261025150000_add_email_notifications` | Cola de notificaciones | Aplicada |
| `20261028120000_add_data_processing_consent` | Documentos legales y evidencia de consentimiento | Aplicada el 29-10-2026 |
| `20261030160000_add_push_and_staff_booking` | Suscripciones push, canal PUSH y cita agendada por staff | Aplicada el 30-10-2026 |

Procedimiento para nuevas migraciones en Supabase:

1. Ejecutar `pnpm exec prisma migrate status` para ver qué falta.
2. Ejecutar `pnpm exec prisma migrate deploy` para aplicarlo.
3. No usar nunca `migrate dev`, `migrate reset` ni `db push` contra Supabase.

---

## 6. Pruebas

| Tipo | Herramienta | Resultado | Fecha |
|---|---|---|---|
| Unitarias API | Jest 30 | 13 suites, 115 pruebas correctas | 30-10-2026 |
| Unitarias web | `node:test` | 88 pruebas correctas | 30-10-2026 |
| E2E API (`apps/api/test/*.e2e-spec.ts`) | Jest + Supertest | 8 suites, 195 pruebas correctas (base de datos simulada) | 30-10-2026 |
| Integración (`apps/api/test/integration`) | Jest + PostgreSQL local desechable | 5 suites, 76 pruebas correctas | 30-10-2026 |
| Integración y concurrencia | Jest (`test/integration`) | Ver `docs/audits/2026-10-29-pruebas-concurrencia.md` | 29-10-2026 |
| Rendimiento | Scripts en `apps/api/test/performance` | Ver la auditoría del 25-10-2026 | 25-10-2026 |

---

## 7. Implementación

### Herramientas Utilizadas en el Desarrollo del Proyecto

El sistema se construyó con TypeScript en todas sus capas, dentro de un repositorio con dos aplicaciones. `apps/api` contiene el backend y `apps/web` el frontend; cada una gestiona sus dependencias con pnpm. La elección de las herramientas atendió a la restricción RES01 (stack definido), a la necesidad de tipado estático para reducir errores, y al despliegue en un hosting compartido con soporte para Node.js.

*Tabla N. Herramientas utilizadas en el desarrollo del proyecto*

| Categoría | Herramienta | Versión | Uso en el proyecto |
|---|---|---|---|
| Lenguaje | TypeScript | 5.9.3 | Lenguaje de la API y de la aplicación web. |
| Entorno de ejecución | Node.js | 24.11 (desarrollo) / 22 (producción) | Ejecución de la API, la web y el procesador de notificaciones. |
| Gestor de paquetes | pnpm | 11.4.0 | Instalación de dependencias y compilación. |
| Framework backend | NestJS | 11.2.7 | API REST modular: controladores, servicios, *guards* y validación. |
| ORM | Prisma ORM (+ `@prisma/adapter-pg`, `pg`) | 7.10.0 (`pg` 8.22.0) | Modelo de datos, migraciones y transacciones. |
| Base de datos | PostgreSQL (Supabase) | Servicio administrado | Persistencia, restricciones, *triggers* y RLS. |
| Framework frontend | Next.js | 16.4.1 | Aplicación web con rutas por rol; PWA. |
| Biblioteca de interfaz | React | 19.2.4 | Componentes de la interfaz. |
| Estilos | Tailwind CSS | 4.3.0 | Diseño responsivo (360 a 1366 px o más). |
| Autenticación | `@nestjs/jwt` (JWT HS256) | 11.0.2 | Tokens de sesión de 15 minutos. |
| Cifrado de contraseñas | bcryptjs | 3.0.3 | Hash de contraseñas (costo 12). |
| Seguridad HTTP | Helmet / `@nestjs/throttler` | 8.3.0 / 6.7.1 | Cabeceras seguras y límite de peticiones. |
| Validación | class-validator / class-transformer | 0.15.1 / 0.5.1 | Validación de los datos de entrada. |
| Correo | Nodemailer | 10.1.7 | Envío de notificaciones por SMTP con TLS. |
| Pruebas | Jest + Supertest / `node:test` | 30.4.2 / 7 / Node | Pruebas unitarias, E2E, de integración y de concurrencia. |
| Calidad de código | ESLint / Prettier | 9.39 / 3 | Reglas de estilo y formato. |
| Control de versiones | Git / GitHub | 2.51.2 | Historial del código y despliegue automático. |
| Editor | Visual Studio Code | 1.144.0 | Entorno de desarrollo. |
| Diagramas | PlantUML (Java 21, Graphviz 2.44.1) | 1.2024.3 | Diagramas UML, E-R y C4 de los anexos. |
| Hosting | Hostinger (plan Business) | — | Publicación de la web, la API, el cron y el servidor SMTP. |
| Base de datos en la nube | Supabase | — | PostgreSQL administrado con TLS. |

*Nota.* Elaboración propia. Versiones tomadas de las dependencias instaladas el 29-10-2026.

> Si la universidad lo exige, declarar aquí el uso de asistentes de inteligencia artificial durante el desarrollo.

### Requisitos del Hardware

Los requisitos de hardware se presentan en tres niveles: el equipo con el que se desarrolló el sistema, la infraestructura donde opera en producción y los dispositivos de los usuarios finales.

*Tabla N. Equipo utilizado para el desarrollo*

| Componente | Especificación |
|---|---|
| Equipo | Portátil ASUS Vivobook 15 (M1502YA) |
| Procesador | AMD Ryzen 7 7730U, 8 núcleos y 16 hilos |
| Memoria RAM | 16 GB (15,4 GB utilizables) |
| Almacenamiento | SSD NVMe de 512 GB (Micron 2400) |
| Gráficos | AMD Radeon Graphics (integrada) |
| Sistema operativo | Windows 11 Pro de 64 bits |

*Nota.* Elaboración propia.

*Tabla N. Requisitos mínimos recomendados*

| Nivel | Requisito mínimo recomendado |
|---|---|
| Equipo de desarrollo | Procesador de 4 núcleos a 64 bits; 8 GB de RAM (16 GB recomendados para ejecutar la API, la web y las pruebas a la vez); 10 GB libres en disco SSD; Windows 10/11, macOS o Linux; Node.js 22 o superior; conexión a internet. |
| Servidor de producción | Hosting con soporte para aplicaciones Node.js 22, dos aplicaciones (web y API), tareas programadas (cron), certificado TLS y correo SMTP. Actualmente se usa el plan Business de Hostinger. *(Completar con los recursos del plan contratado: CPU, RAM y almacenamiento que figuran en el panel de Hostinger.)* |
| Base de datos | Servicio PostgreSQL administrado con conexión TLS (Supabase). *(Completar con el plan contratado.)* |
| Cliente (usuario final) | Computador, tableta o teléfono con pantalla de al menos 360 px de ancho, navegador actualizado (Chrome, Edge, Firefox o Safari) y conexión a internet. No requiere instalación ni periféricos especiales. |

*Nota.* Elaboración propia.

---

## 8. Pendientes y riesgos

Prioridad alta:

- [x] Publicar la Política de Tratamiento de Datos (versión 1.0, 30-10-2026).
- [ ] Hacer commit y push del nuevo texto de la casilla de autorización.
- [ ] Corregir la programación del cron de notificaciones a `*/5 * * * *` y verificar el envío real de correos.
- [ ] Rotar `JWT_SECRET` y la contraseña SMTP.

Tesis:

- [ ] Actualizar el Anexo C (diagrama de clases): faltan `Notification`, `LegalDocument`, `DataProcessingConsent` y las preferencias de recordatorio.
- [ ] Tomar las capturas de pantalla en 360 px y 1366 px.

Funcionalidades:

- [ ] Funciones pendientes del Anexo A: lista de espera (RF-16 y RF-17), nota previa (RF-19), estadísticas (RF-23).
- [ ] Gestión completa de cuentas internas (RF-07).
- [ ] Bloqueos de agenda por fecha (RF-08).
- [x] Portal Staff: agendar para pacientes y ver las citas próximas de cada psicólogo (RF-10, RF-11). Pendiente de despliegue.
- [ ] Staff: cancelar y reprogramar citas de pacientes (RF-12, RF-13).
- [ ] Desplegar push y el portal Staff: claves VAPID en Hostinger (API y cron), commit y push; la migración `20261030160000` ya está aplicada (ver `docs/notificaciones-push-y-recepcion.md`).
- [ ] Edición de perfil del psicólogo y del administrador (RF-05).

Repositorio:

- [ ] Hacer commit de la documentación nueva (`docs/audits/2026-10-29-pruebas-concurrencia.md`, `docs/diagrams/*` nuevos, `docs/tesis/`, este archivo).

---

## 9. Documentación relacionada

| Documento | Contenido |
|---|---|
| `docs/tesis/diseno-software-secciones.md` | Texto de las secciones de diseño de la tesis (despliegue, interfaces, E-R y C4). |
| `docs/diagrams/` | Diagramas fuente (`.puml`) e imágenes: casos de uso, clases, componentes, actividades, despliegue, E-R y C4. |
| `docs/registro-autorizacion-datos.md` | Registro con autorización de datos y pasos de despliegue de la política. |
| `docs/notifications-email.md` | Notificaciones por correo y configuración del cron. |
| `docs/security.md` | Medidas de seguridad. |
| `docs/clinical-foundation.md` / `docs/psychologist-portal.md` | Seguimiento clínico y portal del psicólogo. |
| `docs/audits/` | Auditorías de seguridad, rendimiento y concurrencia. |

---

## 10. Cómo mantener este documento

Cada vez que se avance en el proyecto:

1. **Actualizar la tabla del encabezado:** fecha, último commit (`git log --oneline -1`) y resultados de las pruebas.
2. **Cambiar el estado** del RF o RNF afectado en las secciones 3 y 4, y recalcular los totales.
3. **Al crear una migración,** añadirla a la sección 5 como «Pendiente» y cambiarla a «Aplicada» con la fecha cuando se aplique en Supabase.
4. **Al agregar o actualizar una dependencia,** reflejar la versión en «Herramientas Utilizadas».
5. **Marcar o agregar tareas** en la sección 8.
6. **Añadir una línea al historial** (sección 11).

Comandos para obtener los datos:

```bash
git log --oneline -1
```

```bash
cd apps/api && pnpm test
```

```bash
cd apps/web && node --test tests/*.test.mjs
```

```bash
cd apps/api && pnpm exec prisma migrate status
```

---

## 11. Historial de cambios

| Fecha | Cambio |
|---|---|
| 29-10-2026 | Creación del documento. Migración `20261028120000_add_data_processing_consent` aplicada en Supabase; la API pasa de 500 a 404 en `/legal/data-processing-policy` (política aún no publicada). Pruebas: API 87/87 y web 80/80. Diagramas de despliegue, E-R y C4 creados para la tesis. |
| 30-10-2026 | Publicada la Política de Tratamiento de Datos Personales v1.0 en Supabase; producción la sirve (HTTP 200). Se abren el registro y las reservas. El texto de la casilla de autorización se actualizó en el código, pendiente de despliegue. |
| 30-10-2026 | Notificaciones push en la PWA (todos los roles) y portal Staff: agendar para pacientes, agenda de citas próximas por psicólogo y aviso push al staff por cada cita nueva. Implementado y probado en local (API 115 + 195 e2e + 76 integración, web 88); pendiente de despliegue y de la migración `20261030160000` en Supabase. |
| 30-10-2026 | Migración `20261030160000_add_push_and_staff_booking` aplicada en Supabase (sin divergencias). La API sigue en producción (HTTP 200) tras el redespliegue. |
