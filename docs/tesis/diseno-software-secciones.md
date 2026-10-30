# Diseño del Software — texto para las secciones pendientes

Texto preparado para el capítulo «Diseño del Software (ISO-12207-1)» del documento de grado. Sigue el mismo estilo que las secciones anteriores («Refiérase al anexo …»). Las tablas pueden pegarse en Word y darles formato APA (título en cursiva sobre la tabla, «Nota. Elaboración propia.» debajo).

Todo lo descrito corresponde a lo que está implementado en el código a la fecha (29 de octubre de 2026). Las funciones del Anexo A que todavía no existen se mencionan de forma explícita, sin presentarlas como terminadas.

> **Importante antes de entregar:** el registro con autorización de datos (tablas `LegalDocument` y `DataProcessingConsent`, la pantalla `/autorizacion-de-datos` y la casilla de aceptación del registro) está implementado y probado, pero su migración **todavía no se ha aplicado en Supabase** ni se ha publicado la política definitiva. Hasta que se despliegue, ese módulo no existe en producción. Si la entrega es antes del despliegue, conviene redactarlo como «implementado, pendiente de despliegue».

Archivos de los diagramas (fuente editable `.puml` e imagen `.png`), en `docs/diagrams/`:

| Anexo propuesto | Diagrama | Archivo de imagen | ¿Es UML? |
|---|---|---|---|
| Anexo F | Diagrama de despliegue | `deployment-diagram.png` | Sí (UML 2.5, diagrama de despliegue) |
| Anexo G | Modelo entidad-relación | `er-model.png` | No (notación de pata de gallo / Ingeniería de la Información) |
| Anexo H | C4 nivel 1: contexto | `c4-context.png` | No (notación C4) |
| Anexo I | C4 nivel 2: contenedores | `c4-containers.png` | No (notación C4) |
| Anexo J | C4 nivel 3: componentes | `c4-components.png` | No (notación C4) |

---

## Diagrama de Despliegue

Refiérase al anexo F para visualizar el diagrama de despliegue.

El diagrama de despliegue, elaborado con la notación UML 2.5, representa la distribución física de los artefactos de software de Mental Pieces sobre los nodos de ejecución en los que opera en producción. El sistema se distribuye en cuatro entornos:

1. **Dispositivo del usuario.** Cualquier computador, tableta o teléfono con un navegador web moderno (Chrome, Edge, Firefox o Safari). En el navegador se ejecuta la aplicación web progresiva (PWA), compuesta por HTML, CSS y JavaScript, junto con un *service worker* (`sw.js`) que permite instalar la aplicación y muestra una página informativa cuando no hay conexión. El token de sesión (JWT) se guarda en el almacenamiento de sesión del navegador (`sessionStorage`), de modo que se elimina al cerrar la pestaña.
2. **Servidor de hosting (Hostinger Business).** Aloja dos entornos de ejecución Node.js 22 independientes: la aplicación web (Next.js 16), publicada en `mentalpieces.site`, y la API REST (NestJS 11 con Prisma 7), publicada en `api.mentalpieces.site`. En el mismo nodo de la API reside la utilidad de línea de comandos que procesa la cola de notificaciones; una tarea programada (*cron*) la ejecuta cada cinco minutos. El servidor de correo de Hostinger (`smtp.hostinger.com`, puerto 465) se encarga del envío de los mensajes.
3. **Servicio de base de datos (Supabase).** Contiene la base de datos PostgreSQL con la seguridad a nivel de fila (RLS) activada y sin exposición a través de la API de datos de Supabase; el único acceso es el de la API mediante Prisma.
4. **Repositorio de código (GitHub).** Cada cambio integrado en la rama `main` dispara la compilación (pnpm) y el despliegue automático en Hostinger.

Todas las comunicaciones entre nodos están cifradas: el navegador se comunica con la aplicación web y con la API mediante HTTPS (TLS, puerto 443); la API y el procesador de notificaciones se conectan a PostgreSQL por TCP con TLS, y el envío de correos se realiza por SMTPS (TLS, puerto 465).

---

## Diseño de la Interfaz

### Interfaz de Usuario (Hardware, Software y Comunicaciones)

La interfaz de Mental Pieces es una aplicación web progresiva de diseño responsivo. No requiere instalar software adicional: se usa desde el navegador y, si el usuario lo desea, puede instalarse en la pantalla de inicio del dispositivo. La interfaz se adapta a pantallas desde 360 píxeles de ancho (teléfonos) hasta 1366 píxeles o más (computadores), en cumplimiento del requisito RNF06.

*Tabla N. Requisitos de la interfaz de usuario*

| Tipo | Elemento | Requisito |
|---|---|---|
| Hardware (cliente) | Dispositivo | Computador, tableta o teléfono con pantalla de al menos 360 px de ancho. |
| Hardware (cliente) | Periféricos | Teclado y ratón o pantalla táctil. No requiere impresora, cámara ni lector especial. |
| Hardware (cliente) | Conexión | Acceso a internet. Sin conexión, la PWA muestra una página informativa y no permite operar. |
| Software (cliente) | Navegador | Versión vigente de Google Chrome, Microsoft Edge, Mozilla Firefox o Safari, con JavaScript activado. |
| Software (cliente) | Correo electrónico | Cualquier cliente de correo para recibir las confirmaciones y los recordatorios. |
| Software (servidor) | Aplicación web | Next.js 16, React 19 y Tailwind CSS 4 sobre Node.js 22. |
| Software (servidor) | API | NestJS 11 y Prisma 7 sobre Node.js 22. |
| Software (servidor) | Base de datos | PostgreSQL administrado por Supabase. |
| Comunicaciones | Navegador ↔ aplicación web | HTTPS (TLS) por el puerto 443. |
| Comunicaciones | Navegador ↔ API | HTTPS (TLS) por el puerto 443; intercambio de datos en JSON; autenticación con token JWT en la cabecera `Authorization: Bearer`. |
| Comunicaciones | API ↔ base de datos | Protocolo de PostgreSQL sobre TCP con TLS. |
| Comunicaciones | Envío de correos | SMTP con TLS (SMTPS) por el puerto 465. |

*Nota.* Elaboración propia.

La interfaz se organiza por rol. Después de iniciar sesión, cada usuario es dirigido a su propio panel y solo ve las opciones que su rol permite:

- **Paciente:** panel de inicio, mis citas, agendar cita y perfil.
- **Psicólogo:** panel de inicio, agenda, disponibilidad, pacientes asignados (con historial de notas) y alertas de seguimiento.
- **Administrador:** panel de inicio, usuarios, asignaciones clínicas y alertas.

El control de acceso no depende de ocultar opciones en pantalla: la API vuelve a validar el token y el rol en cada petición.

### Interfaces de Entrada (Formularios, Login)

Las interfaces de entrada se validan en dos niveles. En el navegador se valida para orientar al usuario con mensajes inmediatos. En la API se aplica la validación definitiva, que rechaza cualquier campo no previsto o fuera de los límites. Los mensajes de error se muestran en español y no revelan información interna del sistema.

*Tabla N. Interfaces de entrada del sistema*

| Interfaz (ruta) | Actor | Campos | Validaciones y reglas | Requisito |
|---|---|---|---|---|
| Inicio de sesión (`/login`) | Todos | Correo electrónico; contraseña (con botón para mostrarla u ocultarla). | Correo con formato válido; contraseña de 8 a 72 caracteres. Mensaje genérico si las credenciales no coinciden. Bloqueo temporal de la cuenta tras 5 intentos fallidos en 15 minutos, y máximo 20 intentos por dirección IP cada 15 minutos. Al ingresar, se dirige al panel según el rol. | RF-02, RF-04 |
| Registro de paciente (`/register`) | Paciente | Correo electrónico; contraseña; confirmación de contraseña; casilla de aceptación de la Política de Tratamiento de Datos (con enlace a la política). | Correo único; contraseña de 8 a 72 caracteres, que debe coincidir con la confirmación; la aceptación es obligatoria y se registra la versión aceptada de la política. Máximo 5 registros por hora por dirección IP. La cuenta, el perfil de paciente y la evidencia de autorización se crean en una sola transacción. | RF-01 |
| Autorización de datos (`/autorizacion-de-datos`) | Paciente | Texto completo de la política vigente; casilla de aceptación. | Se muestra cuando se publica una versión nueva que exige volver a aceptar. Sin aceptación vigente no es posible agendar. | RF-01 (Ley 1581 de 2012) |
| Perfil del paciente (`/profile/edit`) | Paciente | Nombre completo; fecha de nacimiento; género (y descripción opcional si elige «otro»); teléfono; preferencia de recordatorios por correo. | Nombre de 2 a 120 caracteres; fecha válida (AAAA-MM-DD); teléfono de 7 a 25 caracteres, solo dígitos y símbolos telefónicos. El rol y el identificador clínico interno no son editables. El perfil completo es obligatorio para agendar; no se permite agendar en línea a menores de 18 años. | RF-05 |
| Agendar cita (`/appointments/new`) | Paciente | Psicólogo; fecha; horario disponible. | Solo se ofrecen espacios futuros, habilitados y libres. Las citas duran 60 minutos. Máximo 4 citas próximas por paciente. La reserva se ejecuta en una transacción serializable que rechaza el cruce de horarios del psicólogo o del paciente. | RF-09, RF-10, RF-14 |
| Reprogramar cita (`/appointments`) | Paciente | Nueva fecha; nuevo horario. | Solo para citas que aún no han iniciado; libera el horario anterior y reserva el nuevo sin duplicar la cita. | RF-13, RF-14 |
| Cancelar cita (`/appointments`) | Paciente | Motivo (opcional). | Motivo de hasta 300 caracteres; se registra la fecha de cancelación y se libera el horario. | RF-12 |
| Disponibilidad (`/psychologist/availability`) | Psicólogo | Día de la semana; hora de inicio; hora de fin. | Horas en formato HH:MM; la hora de fin debe ser posterior a la de inicio; se rechazan los bloques superpuestos. | RF-08 |
| Registro de asistencia (`/psychologist/appointments`) | Psicólogo | Acción «Realizada» o «No asistió». | Solo sobre citas propias en estado «programada» y después de su hora de finalización. | RF-15 |
| Nota clínica (`/psychologist/patients/[id]`) | Psicólogo | Contenido de la nota; cita asociada (opcional). | De 1 a 10 000 caracteres. Solo es posible si existe una relación clínica activa con el paciente. Cada consulta y cada registro quedan en la bitácora de auditoría. | RF-20, RF-21 |
| Crear cuenta interna (`/admin/users`) | Administrador | Correo; contraseña inicial; nombre completo; rol (Psicólogo o Personal administrativo); teléfono (opcional); cargo (opcional). | Correo único; contraseña de 8 a 72 caracteres; nombre de 2 a 120 caracteres; rol limitado a Psicólogo o Personal administrativo (no se pueden crear administradores desde la interfaz). | RF-06 |
| Asignación clínica (`/admin/clinical-assignments`) | Administrador | Paciente; psicólogo; acción de finalizar la relación. | Una sola relación por pareja paciente–psicólogo; la relación finalizada conserva su historial. | RF-21 |

*Nota.* Elaboración propia.

### Interfaces de Salida (Reportes, Consultas, Impresiones)

Las salidas del sistema se agrupan en consultas en pantalla, reportes de seguimiento y notificaciones por correo. Ninguna salida administrativa muestra el contenido de las notas clínicas: este solo es visible para el psicólogo que tiene la relación clínica activa (RNF01).

*Tabla N. Interfaces de salida del sistema*

| Tipo | Salida (ruta) | Actor | Contenido | Requisito |
|---|---|---|---|---|
| Consulta | Panel del paciente (`/dashboard`) | Paciente | Próxima cita y accesos rápidos. Si falta completar el perfil o aceptar la política, el sistema redirige primero a esa pantalla. | RF-11 |
| Consulta | Mis citas (`/appointments`) | Paciente | Citas próximas e historial, con estado (programada, realizada, cancelada, no asistió), psicólogo, fecha y hora. | RF-11 |
| Consulta | Horarios disponibles (`/appointments/new`) | Paciente | Espacios libres de 60 minutos por psicólogo y fecha. | RF-09 |
| Consulta | Mi perfil (`/profile`) | Paciente | Datos personales, identificador interno y preferencia de recordatorios. | RF-05 |
| Consulta | Agenda (`/psychologist/appointments`) | Psicólogo | Citas asignadas por fecha, con estado y paciente. | RF-11 |
| Consulta | Pacientes asignados e historial (`/psychologist/patients`) | Psicólogo | Lista de pacientes con relación activa e historial paginado de notas de evolución de cada paciente. | RF-21 |
| Consulta | Usuarios (`/admin/users`) | Administrador | Cuentas internas con rol y estado. | RF-07 (parcial: solo consulta) |
| Consulta | Asignaciones (`/admin/clinical-assignments`) | Administrador | Relaciones paciente–psicólogo activas y finalizadas, sin contenido clínico. | RF-21 |
| Reporte | Alertas de seguimiento (`/psychologist/alerts`, `/admin/alerts`) | Psicólogo, Administrador | Pacientes que requieren seguimiento, ordenados por días sin actividad. Reglas: sin primera sesión 14 días después de la asignación; más de 30 días sin sesión (severidad alta desde 60 días); 2 inasistencias seguidas. No emite diagnósticos. | RF-22 |
| Notificación | Confirmación de cita (correo) | Paciente y psicólogo | Fecha, hora y profesional de la cita agendada. | RF-18 |
| Notificación | Reprogramación de cita (correo) | Paciente y psicólogo | Horario anterior y nuevo horario. | RF-18 |
| Notificación | Cancelación de cita (correo) | Paciente y psicólogo | Cita cancelada y horario liberado. | RF-18 |
| Notificación | Recordatorio 24 horas antes (correo) | Paciente | Recordatorio de la cita; solo si el paciente activó los recordatorios. | RF-18 |

*Nota.* Elaboración propia.

Los correos se generan en la misma transacción que modifica la cita (patrón *outbox*). Un procesador independiente los envía cada cinco minutos, con un máximo de 4 intentos por mensaje y una clave de idempotencia que impide enviarlos dos veces.

**Impresiones.** La versión actual no incluye un módulo de impresión ni de exportación a PDF. Las pantallas de consulta pueden imprimirse con la función de impresión del navegador. Tampoco está implementado el módulo de estadísticas administrativas (RF-23); queda como trabajo futuro.

---

## Diseño del Modelo de Datos / Persistencia (Modelo E-R)

Refiérase al anexo G para visualizar el modelo entidad-relación.

La persistencia se implementa en PostgreSQL. El esquema se define y versiona con Prisma ORM mediante migraciones. El modelo entidad-relación, en notación de pata de gallo, representa las once tablas del sistema y sus relaciones:

*Tabla N. Entidades del modelo de datos*

| Entidad | Descripción |
|---|---|
| User | Cuenta de acceso: correo único, contraseña cifrada con bcrypt, rol (paciente, psicólogo, administrador o personal) y estado. |
| Patient | Perfil del paciente, vinculado uno a uno con su cuenta. Incluye el identificador clínico interno único (MRN), los datos personales y la preferencia de recordatorios. |
| StaffProfile | Perfil del personal interno (psicólogos y personal administrativo), vinculado uno a uno con su cuenta. |
| PsychologistAvailability | Bloques semanales de atención de cada psicólogo (día, minuto de inicio y de fin). |
| Appointment | Cita entre un paciente y un psicólogo, con fecha, horario de 60 minutos, estado y datos de cancelación. |
| CareRelationship | Relación clínica autorizada entre un paciente y un psicólogo. Determina quién puede consultar y registrar notas. |
| ClinicalSessionNote | Nota de evolución escrita por el psicólogo, asociada opcionalmente a una cita realizada. |
| AuditLog | Bitácora de auditoría de las acciones sobre información clínica (quién, qué acción, sobre qué recurso y cuándo). |
| Notification | Cola de correos pendientes y enviados, con control de intentos, bloqueo temporal e idempotencia. |
| LegalDocument | Versiones publicadas de la Política de Tratamiento de Datos, con su huella SHA-256. |
| DataProcessingConsent | Evidencia de la autorización de tratamiento de datos: usuario, versión y huella del documento aceptado, finalidad, origen y fecha registrada por el servidor. |

*Nota.* Elaboración propia.

Además de las claves primarias y foráneas, la integridad de los datos se protege con las siguientes reglas:

- **Unicidad:** correo del usuario; MRN del paciente; una relación clínica por pareja paciente–psicólogo; una nota principal por cita; clave de idempotencia de cada notificación; versión de cada documento legal; un consentimiento por usuario, documento y finalidad.
- **Restricción de verificación (CHECK):** la huella SHA-256 almacenada debe coincidir con el texto de la política.
- **Reglas validadas por la API antes de escribir:** formato de fecha y hora, duración de 60 minutos, hora de fin posterior a la de inicio y ausencia de cruces de horario.
- **Disparadores (*triggers*):** impiden modificar una política ya publicada o una evidencia de consentimiento, y fijan la fecha de aceptación con la hora del servidor.
- **Relación clínica en las notas:** las notas referencian la relación clínica mediante la pareja paciente–psicólogo, de modo que no puede existir una nota sin relación autorizada.
- **Seguridad a nivel de fila (RLS):** está activa en todas las tablas y bloquea el acceso directo desde la API de datos de Supabase.

Las operaciones de agendamiento usan transacciones con aislamiento serializable (RNF04). Las pruebas de concurrencia correspondientes se documentan en `docs/audits/2026-10-29-pruebas-concurrencia.md`.

---

## Diseño de la Arquitectura de Software (Modelo C4, Nivel 1, Nivel 2 y 3)

La arquitectura se describe con el modelo C4 (Brown, 2018). El modelo representa el sistema en niveles de detalle creciente: contexto, contenedores y componentes. Mental Pieces sigue una arquitectura de monolito modular: un único backend organizado en módulos con responsabilidades separadas, una aplicación web cliente y una base de datos relacional.

### Nivel 1 — Diagrama de contexto

Refiérase al anexo H para visualizar el diagrama de contexto.

El diagrama de contexto ubica a Mental Pieces frente a sus usuarios y a los sistemas externos con los que interactúa.

- **Usuarios:** el paciente agenda y administra sus citas; el psicólogo gestiona su disponibilidad, su agenda y el seguimiento clínico; el administrador gestiona las cuentas internas y las asignaciones.
- **Supabase:** servicio administrado donde reside la base de datos PostgreSQL.
- **Servidor de correo de Hostinger:** entrega las notificaciones de citas.
- **GitHub:** contiene el código fuente y origina el despliegue automático.

### Nivel 2 — Diagrama de contenedores

Refiérase al anexo I para visualizar el diagrama de contenedores.

El sistema se divide en cuatro contenedores:

1. **Aplicación web (PWA):** desarrollada con Next.js 16 y React 19. Ofrece la interfaz por rol y consume la API.
2. **API REST:** desarrollada con NestJS 11 sobre Node.js 22. Concentra la lógica de negocio, la autenticación con JWT, el control de acceso por roles y los límites de peticiones.
3. **Procesador de notificaciones:** utilidad de línea de comandos ejecutada por una tarea programada cada cinco minutos. Toma los correos pendientes con bloqueo `FOR UPDATE SKIP LOCKED`, los envía y registra el resultado.
4. **Base de datos PostgreSQL:** almacena la información del sistema y se accede únicamente a través de Prisma.

La aplicación web se comunica con la API por HTTPS en formato JSON. La API registra las notificaciones en la misma transacción que modifica la cita, de modo que no se pierde ningún aviso aunque falle el envío.

### Nivel 3 — Diagrama de componentes de la API

Refiérase al anexo J para visualizar el diagrama de componentes de la API.

El tercer nivel detalla los componentes internos de la API REST, que corresponden a los módulos de NestJS:

- **Seguridad transversal:** cabeceras seguras (Helmet), CORS restringido, validación de datos, límite de peticiones, verificación del JWT y verificación del rol. Se aplica a cada petición antes de llegar a los módulos.
- **AuthModule:** inicio de sesión, emisión del token y consulta de la sesión actual.
- **UsersModule:** registro público de pacientes con la evidencia de autorización de datos.
- **StaffModule:** creación y consulta de cuentas internas.
- **PatientsModule:** perfil del paciente, aceptación de nuevas versiones de la política y preferencia de recordatorios.
- **LegalModule:** publicación de la política vigente.
- **AvailabilityModule:** horarios de los psicólogos y cálculo de espacios libres.
- **AppointmentsModule:** agendamiento, reprogramación, cancelación y asistencia. Antes de agendar exige el perfil completo y el consentimiento vigente.
- **ClinicalModule:** asignaciones clínicas, notas, auditoría y alertas de seguimiento.
- **NotificationsModule:** cola de correos y su procesamiento.
- **DatabaseModule:** acceso a datos y gestión de transacciones con Prisma.

Para el detalle de clases y la relación entre módulos, véanse también los anexos C (diagrama de clases) y D (diagrama de componentes UML).

---

## Referencia sugerida (APA 7)

Brown, S. (2018). *The C4 model for visualising software architecture*. https://c4model.com
