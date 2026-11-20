; JARVIS AI — Instalador per-user (não exige administrador)
Unicode True

; JARVIS AI — Instalador per-user (não exige administrador)
; Compilar: makensis installer.nsi
; Saída:   release\JARVIS AI-Setup-1.2.2.exe
;
; O que faz: copia o app para %LOCALAPPDATA%\Programs\JARVIS AI, cria atalhos
; (área de trabalho + menu Iniciar), registra em "Aplicativos instalados" com
; desinstalador. NÃO instala Node, Chrome, Ollama nem nenhuma dependência — o
; app é autossuficiente (Electron embutido). Dados do usuário ficam em
; %USERPROFILE%\Documents\JARVIS\data e NÃO são apagados na desinstalação.

!define APP_NAME      "JARVIS AI"
!define APP_VERSION   "1.2.2"
!define APP_PUBLISHER "JARVIS"
!define APP_EXE       "JARVIS AI.exe"
!define APP_ID        "JARVISAI"
!define ESTIMATED_SIZE 1075200 ; ~1,05 GB em KB

Name "${APP_NAME}"
OutFile "..\release\${APP_NAME}-Setup-${APP_VERSION}.exe"
InstallDir "$LOCALAPPDATA\Programs\${APP_NAME}"
InstallDirRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "InstallLocation"
RequestExecutionLevel user
ShowInstDetails nevershow
ShowUninstDetails nevershow
SetCompressor lzma

; Informações de versão do instalador (aparecem nas propriedades do arquivo)
VIProductVersion "1.2.2.0"
VIAddVersionKey "CompanyName" "${APP_PUBLISHER}"
VIAddVersionKey "FileDescription" "JARVIS — agente pessoal de tecnologia com IA (chat multimodal, estúdio de vídeo, agentes, WhatsApp oficial)"
VIAddVersionKey "ProductName" "${APP_NAME}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "© 2026 ${APP_PUBLISHER}. Uso pessoal."

!include "MUI2.nsh"

!define MUI_ICON "..\release-staging\electron\icon-256.ico"
!define MUI_UNICON "..\release-staging\electron\icon-256.ico"
!define MUI_WELCOMEPAGE_TEXT "Este assistente instala o JARVIS AI neste computador.$\r$\n$\r$\nO que será feito:$\r$\n• Copiar o JARVIS AI para $LOCALAPPDATA\Programs\JARVIS AI$\r$\n• Criar atalho na área de trabalho e no menu Iniciar$\r$\n• Registrar em Aplicativos instalados (Windows) com opção de desinstalar$\r$\n$\r$\nO que NÃO será instalado: Node.js, Git, Chrome, Ollama, Python — o JARVIS é autossuficiente.$\r$\n$\r$\nSeus dados (conversas, chaves, projetos) ficam em Documentos\JARVIS\data e não serão tocados.$\r$\n$\r$\nClique em Avançar para continuar."
!define MUI_WELCOMEPAGE_TITLE "Instalar ${APP_NAME} ${APP_VERSION}"
!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Abrir o JARVIS AI agora"
!define MUI_FINISHPAGE_TITLE "Instalação concluída"
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "PortugueseBR"
!insertmacro MUI_LANGUAGE "English"

Section "Instalação" SecInstall
  SetOutPath "$INSTDIR"

  ; Remove instalação anterior completa (nunca apaga dados do usuário)
  RMDir /r "$INSTDIR"
  CreateDirectory "$INSTDIR"

  File /r "..\release-staging\release\win-unpacked\*.*"

  ; Atalho no Menu Iniciar
  CreateDirectory "$SMPROGRAMS\${APP_NAME}"
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\${APP_NAME}\Desinstalar ${APP_NAME}.lnk" "$INSTDIR\Uninstall ${APP_NAME}.exe"

  ; Atalho na área de trabalho
  CreateShortcut "$DESKTOP\${APP_NAME}.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0

  ; Registro do Windows — "Aplicativos instalados"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "UninstallString" '"$INSTDIR\Uninstall ${APP_NAME}.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "NoRepair" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}" "EstimatedSize" ${ESTIMATED_SIZE}

  ; Desinstalador
  WriteUninstaller "$INSTDIR\Uninstall ${APP_NAME}.exe"
SectionEnd

Section "Uninstall"
  RMDir /r "$INSTDIR"

  Delete "$DESKTOP\${APP_NAME}.lnk"
  RMDir /r "$SMPROGRAMS\${APP_NAME}"

  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"

  ; Documentos\JARVIS\data NÃO é apagado — seus dados ficam com você
SectionEnd
