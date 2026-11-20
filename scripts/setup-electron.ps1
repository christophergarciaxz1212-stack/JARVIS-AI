# Setup: instala/garante que o binário do Electron funciona quando
# o npm desta máquina bloqueia o postinstall do pacote `electron`.
# Executa de forma idempotente: se o dist já existe e é válido, não faz nada.
#
# Uso: powershell -ExecutionPolicy Bypass -File scripts/setup-electron.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$electronPkg = Join-Path $root 'node_modules\electron'

if (-not (Test-Path $electronPkg)) {
  Write-Output 'Electron ainda não instalado — rode `npm install` primeiro.'
  exit 1
}

# 1. Descobrir qual versão do Electron o package.json pede
$pkg = Get-Content (Join-Path $root 'package.json') -Raw | ConvertFrom-Json
$match = $pkg.devDependencies.electron
if (-not $match) {
  $match = $pkg.dependencies.electron
}
$version = if ($match -match '[\d.]+$') { $Matches[0] } else { '42.11.18' }
Write-Output "Versão esperada: electron $version"

# 2. Se node_modules/electron/dist/electron.exe já existe e está íntegro, sair
$dist = Join-Path $electronPkg 'dist'
$exe = Join-Path $dist 'electron.exe'
if (Test-Path $exe) {
  try {
    $cmd = "`"$exe`" --version"
    $out = cmd /c $cmd
    if ($out -match '^v\d+') {
      Write-Output "Electron OK: $out (dist já presente)"
      exit 0
    }
  } catch {}
}

# 3. O npm bloqueia postinstall, então o dist está ausente. Instalar manualmente.
Write-Output 'Postinstall do Electron foi bloqueado pelo npm — baixando binário oficial.'

# Verificar cache local (electron-v*-win32-x64.zip)
$cacheBase = "$env:LOCALAPPDATA\electron\Cache"
$zipFile = $null
if (Test-Path $cacheBase) {
  $zipFile = Get-ChildItem $cacheBase -Recurse -Filter "electron-v$version-win32-x64.zip" -ErrorAction SilentlyContinue | Select-Object -First 1
}

if ($zipFile) {
  Write-Output "Cache encontrado: $($zipFile.FullName) ($([math]::Round($zipFile.Length/1MB,1)) MB)"
  Expand-Archive -LiteralPath $zipFile.FullName -DestinationPath $dist -Force
  Set-Content (Join-Path $electronPkg 'path.txt') 'electron.exe' -NoNewline -Encoding ASCII
  Write-Output 'Electron instalado em node_modules\electron\dist'
  exit 0
}

Write-Output 'Cache não encontrado; tentando baixar via @electron/get'
Push-Location $root
try {
  node -e "const {downloadArtifact}=require('@electron/get');downloadArtifact({version:'$version',artifactName:'electron',platform:'win32',arch:'x64',checksums:require('./node_modules/electron/checksums.json')}).then(p=>console.log('ZIP:',p)).catch(e=>{console.error('ERRO:',e.message);process.exit(1)})"
  if ($LASTEXITCODE -ne 0) { throw "download falhou" }
} finally {
  Pop-Location
}

Write-Output 'Electron instalado.'
