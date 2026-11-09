@echo off
title PrecioAlerta Peru (local)
cd /d "%~dp0"
echo Iniciando PrecioAlerta Peru en http://localhost:3000 ...
start "" http://localhost:3000
node server.js
echo.
echo El servidor se detuvo. Presiona una tecla para cerrar.
pause >nul
