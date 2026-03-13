# Deploy en Render

## Estado actual del proyecto

- Backend Flask en `server.py`
- Frontend estatico servido por Flask
- Persistencia local actual en `finance.db` (SQLite)
- Soporte para PostgreSQL activado cuando existe `DATABASE_URL`
- Blueprint de Render definido en `render.yaml`

## Cambios ya preparados

- `render.yaml` crea un servicio web y una base PostgreSQL en Render
- `/health` sirve como health check para Render
- `db.py` inicializa el esquema tanto en SQLite como en PostgreSQL
- `migrate_to_postgres.py` copia los datos de SQLite a PostgreSQL

## Flujo recomendado

1. Sube este repositorio a GitHub.
2. En Render, crea el servicio usando `Blueprint` y apunta al repo.
3. Render leerá `render.yaml` y creara:
   - el servicio web `supervivencia-semanal`
   - la base `supervivencia-db`
4. Cuando Render termine, abre el servicio y valida `https://TU-APP.onrender.com/health`.
5. Obtiene el `External Database URL` o usa el `connectionString` del blueprint para migrar los datos existentes.
6. Ejecuta la migracion desde tu maquina local:

```powershell
$env:DATABASE_URL="postgresql://USUARIO:PASSWORD@HOST:PUERTO/DBNAME"
.\venv\Scripts\python.exe migrate_to_postgres.py --wipe-destination
```

7. Vuelve a cargar la app en Render y valida que los datos aparezcan correctamente.

## Notas de operacion

- En local, si `DATABASE_URL` no existe, la app sigue usando `finance.db`.
- En Render, `DATABASE_URL` llega desde la base PostgreSQL declarada en `render.yaml`.
- Si tu objetivo es que el sistema este siempre disponible, no uses el tier gratis del servicio web.
- La base definida hoy en `render.yaml` usa `plan: free`; para un entorno estable conviene cambiarla a un plan pagado antes de operar en serio.
- `--wipe-destination` borra primero el contenido de PostgreSQL antes de importar; usalo solo si quieres reemplazar todo.
- Si prefieres una migracion no destructiva, ejecuta el script sin `--wipe-destination`.

## Validacion minima despues del deploy

- `GET /health` responde `200`
- `GET /api/transactions` responde con datos
- `GET /api/settings` responde con `categories` y `fixedCosts`
- La pantalla principal carga `index.html`, `js/app.js` y `css/styles.css`
