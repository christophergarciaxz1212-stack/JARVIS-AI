@echo off
setlocal
title Encerrar JARVIS
echo Encerrando o servidor do JARVIS na porta 3001...
for /f "tokens=5" %%p in ('netstat -ano ^| findstr /r /c:":3001 .*LISTENING"') do (
  taskkill /pid %%p /t /f >nul 2>&1
  echo  processo %%p encerrado
)
echo Pronto.
ping -n 2 127.0.0.1 >nul
