@echo off
setlocal
title JARVIS - Recompilar
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs"

echo.
echo  Recompilando o JARVIS (Turbopack, ~1 minuto)...
echo.
call npm run build
if errorlevel 1 (
  echo.
  echo  [!] O build falhou. O app continua rodando com a versao anterior.
  pause
  exit /b 1
)
echo.
echo  [*] Build atualizado. Abra o JARVIS normalmente.
ping -n 3 127.0.0.1 >nul
