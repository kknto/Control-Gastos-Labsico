@echo off
echo Iniciando servidor...

if not exist venv (
    echo Entorno virtual no encontrado. Ejecutando setup...
    call setup_app.bat
)

call venv\Scripts\activate

echo Abriendo navegador...
start http://localhost:5000

echo Servidor corriendo. No cierres esta ventana.
python server.py
pause
