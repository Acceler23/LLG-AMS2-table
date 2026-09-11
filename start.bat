@echo off
cd /d "%~dp0"

if not exist "node_modules" (
    echo Instalando dependencias...
    call npm install
)

start "AMS2 Server" cmd /k "npm start"
timeout /t 2 /nobreak >nul
start "AMS2 Listener" powershell -ExecutionPolicy Bypass -File "%~dp0listener.ps1"
timeout /t 1 /nobreak >nul
start "AMS2 Hotkeys" powershell -ExecutionPolicy Bypass -File "%~dp0hotkeys.ps1"
