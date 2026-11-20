# Creates/refreshes the "JARVIS AI" shortcuts on the Desktop and in the Start Menu.
# Run: npm run atalho   (safe to run any number of times)
# Prefers the self-contained installed program (%LOCALAPPDATA%\Programs\JARVIS\JARVIS.exe);
# falls back to the Electron runtime in this project when the program is not installed.
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$program = Join-Path $env:LOCALAPPDATA 'Programs\JARVIS\JARVIS.exe'
$installedIcon = Join-Path $env:LOCALAPPDATA 'Programs\JARVIS\resources\app\electron\jarvis-icon.ico'
$icon = Join-Path $root 'electron\jarvis-main.ico'
$iconFinal = $icon
if (Test-Path $installedIcon) { $iconFinal = $installedIcon }

if (Test-Path $program) {
  $target = $program
  $arguments = '--no-sandbox'
  $workDir = Split-Path $program
} else {
  $target = Join-Path $root 'node_modules\electron\dist\electron.exe'
  $arguments = '--no-sandbox "' + $root + '"'
  $workDir = $root
  if (-not (Test-Path $target)) {
    Write-Error "electron.exe nao encontrado em $target. Rode 'npm install' ou instale o programa em $env:LOCALAPPDATA\Programs\JARVIS\"
  }
}

$targets = @(
  (Join-Path ([Environment]::GetFolderPath('Desktop')) 'JARVIS AI.lnk'),
  (Join-Path ([Environment]::GetFolderPath('Programs')) 'JARVIS AI.lnk')
)
$ws = New-Object -ComObject WScript.Shell
foreach ($lnk in $targets) {
  $s = $ws.CreateShortcut($lnk)
  $s.TargetPath = $target
  # --no-sandbox: without it Electron dies at startup on this PC (0xC0000005 in Chromium startup)
  $s.Arguments = $arguments
  $s.WorkingDirectory = $workDir
  $s.IconLocation = "$iconFinal,0"
  $s.Description = 'JARVIS AI - agente pessoal'
  $s.Save()
  $check = $ws.CreateShortcut($lnk)
  if ($check.TargetPath -ne $target) { Write-Error "Falha ao gravar $lnk" }
  Write-Output "ok  $lnk  ->  $target"
}
