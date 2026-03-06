@echo off
echo ==========================================
echo Configurando Sistema de Control de Solvencia
echo ==========================================

echo 1. Creando entorno virtual (venv)...
py -m venv venv
if %errorlevel% neq 0 (
    echo [ERROR] No se pudo crear el entorno virtual con 'py'.
    echo Intentando con 'python'...
    python -m venv venv
    if %errorlevel% neq 0 (
        echo [ERROR] No se pudo crear el entorno virtual.
        echo Por favor instala Python desde python.org y marca "Add to PATH".
        pause
        exit /b
    )
)

echo 2. Activando entorno...
call venv\Scripts\activate

echo 3. Instalando Flask...
pip install flask
if %errorlevel% neq 0 (
    echo [ERROR] Fallo la instalacion de Flask.
    pause
    exit /b
)

echo.
echo ==========================================
echo INSTALACION COMPLETADA EXITOSAMENTE
echo ==========================================
echo Ahora puedes ejecutar 'start_app.bat' para abrir la aplicacion.
echo.
pause
