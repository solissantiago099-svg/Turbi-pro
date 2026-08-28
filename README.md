# TAMIZ RUTAS — MVP

Versión modular de prueba del sistema. Guarda datos en el navegador mediante `localStorage` y conserva las claves históricas `tamiz_tasks` y `tamiz_vehicles`.

## Cómo ejecutarlo

1. Descomprimir el ZIP.
2. Abrir una terminal dentro de la carpeta `tamiz_rutas_mvp`.
3. Ejecutar:

```bash
python -m http.server 8000
```

4. Abrir `http://localhost:8000`.

Si Python no está instalado, desde PowerShell ejecutar:

```powershell
powershell -ExecutionPolicy Bypass -File .\serve.ps1
```

## Build para despliegue

```bash
npm run build
```

El build genera `dist/server/index.js`, que sirve la app estática y expone los endpoints demo `/api/geocode` y `/api/route` para el cálculo de rutas.

## Incluye

- Mi Ruta con toggles y cambio de estado.
- Nueva Tarea con validación básica de tiempo.
- Agenda mensual.
- Supervisión.
- Vehículos, documentación, alertas y mantenimientos.
- Historial y semáforo de salud.
- Ciclo de tareas: pendiente, en trabajo, en destino y realizada.
- Registro de horas reales, permanencia en destino e incidencias.
- Ruta completa del día mediante enlaces de Google Maps.
- Validación básica de superposición por chofer.

## Estructura

- `js/app.js`: navegación y vistas.
- `js/storage.js`: persistencia compatible con el MVP anterior.
- `js/maps.js`: generación de rutas en modo demo.
- `js/utils.js`: fechas, estados, formato y seguridad de texto.

## Para producción real falta

- Backend y base de datos multiusuario.
- Usuarios, contraseñas y permisos.
- Google Maps Routes/Traffic API.
- Geolocalización en segundo plano y alerta a 1 km.
- Notificaciones push.
- Carga segura de PDFs.
- Copias de seguridad y auditoría.
