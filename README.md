# TAMIZ RUTAS

App operativa para gestionar agenda de tareas, rutas, choferes y vehiculos.

## Estado actual

- Frontend migrado a Next + React.
- Login propio para usuarios de la operacion.
- Base compartida con D1 en Sites.
- Agenda diaria con horarios de 07:00 a 19:00.
- Nueva tarea con paradas, PDF, resumen y calculo OSRM.
- Roles iniciales: supervisor y chofer.

## Usuarios iniciales

- `admin / admin123`
- `chofer / chofer123`

## Desarrollo local

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

El build genera `dist/server/index.js`, que sirve la app estatica de Next y mantiene los endpoints:

- `/api/login`
- `/api/logout`
- `/api/session`
- `/api/state`
- `/api/geocode`
- `/api/route`

## Produccion

La app esta publicada con Sites en:

https://tamiz-rutas.solissantiago099.chatgpt.site
