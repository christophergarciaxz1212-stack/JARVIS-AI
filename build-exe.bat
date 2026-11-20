@echo off
setlocal
title JARVIS - Gerar JARVIS.exe
cd /d "%~dp0"

set "CSC=C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe"
if not exist "%CSC%" set "CSC=C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
if not exist "%CSC%" (
  echo [!] Compilador C# do .NET Framework nao encontrado.
  pause
  exit /b 1
)

echo.
echo  Gerando JARVIS.exe com o icone do JARVIS...
"%CSC%" -nologo -target:winexe -optimize+ -out:JARVIS.exe -win32icon:electron\jarvis-main.ico launcher.cs
if errorlevel 1 (
  echo.
  echo [!] Falha ao gerar o executavel.
  pause
  exit /b 1
)

echo.
echo  [*] JARVIS.exe gerado com sucesso.
ping -n 3 127.0.0.1 >nul
