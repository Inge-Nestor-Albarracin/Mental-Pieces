# Pruebas de carga (solo lectura, locales y acotadas)

Estos scripts **no** se ejecutan con `npm test` y se niegan a apuntar a un host que no sea local.
No sirven para estimar la capacidad de Hostinger ni de Supabase. Ver
`docs/audits/2026-10-25-auditoria-seguridad-concurrencia-rendimiento.md`.

## Requisitos

- PostgreSQL **local y desechable** con un nombre de base que contenga `test`, con las migraciones
  aplicadas (`prisma migrate deploy` con `DATABASE_URL` apuntando **solo** a esa base).
- La API compilada (`npm run build`) ejecutándose en un puerto libre (ej. 3941) con esa base y un
  `JWT_SECRET` de prueba. No uses el puerto 3001 si ya hay una API tuya corriendo.

## Pasos

```bash
# 1. Volumen sintético (300 pacientes, 3 000 citas, 100 relaciones, notas sintéticas)
PERF_DATABASE_URL=<url local de prueba> PERF_FIXTURES_OUT=perf-fixtures.json node test/performance/seed-synthetic.cjs

# 2. API local contra esa base (en otra terminal)
DATABASE_URL=<url local de prueba> JWT_SECRET=<secreto de prueba> PORT=3941 node dist/src/main.js

# 3. Carga escalonada 1 → 5 → 10 → 25 VUs (20 s cada uno) y ráfagas 5/10/25
PERF_FIXTURES=perf-fixtures.json PERF_JWT_SECRET=<secreto de prueba> PERF_API_PID=<pid de la API> \
  PERF_OUT=perf-results.json node test/performance/read-load.cjs
```

## Límites de protección

- Tasa fija de 1,6 solicitudes/s por ruta (96/min), por debajo del límite de la API (120/min/IP).
  Las alertas (límite 20/min) usan 0,3 solicitudes/s y ráfagas de 5 y 10.
- Se detiene un escenario si los 5xx superan el 1 %, si el p95 pasa de 3 s o si hay timeouts.
- Solo peticiones `GET`. No crea citas ni notas; las carreras de reserva están en
  `test/integration/appointments-concurrency.integration-spec.ts`.
- El nivel de 50 VUs y cualquier prueba remota requieren autorización expresa y un plan aparte.

## Salida

JSON agregado (latencias p50/p95/p99, códigos HTTP, CPU y RAM de la API). Nunca guarda tokens,
cabeceras ni cuerpos de respuesta.
