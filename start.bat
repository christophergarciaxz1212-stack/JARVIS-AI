@echo off
setlocal
title JARVIS AI
cd /d "%~dp0"
set "PATH=%PATH%;C:\Program Files\nodejs"

set "PORT=3001"
set "URL=http://127.0.0.1:%PORT%"
set "MARKER=data\no-electron"
set "EDGE=C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"

echo.
echo  ==========================================
echo    JARVIS AI
echo  ==========================================
echo.

if not exist "node_modules\next\package.json" (
  echo  [*] Primeira execucao: instalando dependencias...
  call npm install --no-audit --no-fund
  echo.
)

curl -s -o nul --max-time 2 "%URL%" >nul 2>&1
if not errorlevel 1 goto ready

echo  [*] Iniciando servidor...
if exist ".next\BUILD_ID" (
  start "JARVIS server" /min cmd /c "npm run start"
) else (
  start "JARVIS server" /min cmd /c "npm run dev"
)

set /a tries=0
:wait
set /a tries+=1
curl -s -o nul --max-time 2 "%URL%" >nul 2>&1
if not errorlevel 1 goto ready
if %tries% GEQ 120 goto fallback
ping -n 2 127.0.0.1 >nul
goto wait

:ready
echo  [*] Servidor online em %URL%

if exist "%MARKER%" goto window
if not exist "node_modules\electron\dist\electron.exe" goto window

echo  [*] Tentando janela nativa...
start "" "node_modules\electron\dist\electron.exe" "%~dp0"
ping -n 12 127.0.0.1 >nul
tasklist /fi "imagename eq electron.exe" 2>nul | "%SystemRoot%\System32\findstr.exe" /i /c:"electron.exe" >nul
if not errorlevel 1 (
  echo  [*] Janela nativa aberta.
  exit /b 0
)

if not exist "data" mkdir "data"
type nul > "%MARKER%"
echo  [!] Janela nativa bloqueada neste Windows. Usando janela propria do Edge.

:window
if not exist "%EDGE%" goto plain
start "" "%EDGE%" --app="%URL%" --window-size=1440,900 --user-data-dir="%LOCALAPPDATA%\JARVIS\window"
echo  [*] JARVIS aberto.
exit /b 0

:plain
start "" "%URL%"
exit /b 0

:fallback
echo  [!] O servidor demorou para responder. Abrindo no navegador...
start "" "%URL%"
exit /b 0
