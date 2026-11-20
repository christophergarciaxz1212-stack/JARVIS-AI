# Sincroniza o build de produção (.next) para o pacote instalado e impede
# que o auto-atualizador do app troque o build por um antigo na próxima abertura.
#
# Por que existe:
#   - electron/main.js mantém um auto-atualizador: na abertura, `applyStagedBuild()`
#     promove `.next-staging` para `.next`, e `scheduleBackgroundUpdate()` reconstrói
#     em segundo plano quando `src` está mais novo que o BUILD_ID. Rodar `next build`
#     no projeto de dev e copiar `.next` na mão é sobrescrito por esse mecanismo
#     (o app fica "preso" em um build antigo).
#   - Este script copia o build atual, remove o staging/lixo, e fixa o mtime de
#     `.next` para o futuro — assim `buildIsStale()` é falso e nada é trocado
#     na próxima abertura. O build no pacote é sempre exatamente o do repositório.
#
# Uso:
#   powershell -NoProfile -ExecutionPolicy Bypass -File scripts/sync-packaged.ps1 [-Launch]

param([switch]$Launch)

$ErrorActionPreference = 'Continue'
$src = Split-Path -Parent $PSScriptRoot
$pkg = "$env:LOCALAPPDATA\Programs\JARVIS\resources\app"
$stage = Join-Path $pkg '.next-staging'
$exe   = "$env:LOCALAPPDATA\Programs\JARVIS\JARVIS.exe"

if (-not (Test-Path $pkg)) { Write-Error "Pacote não encontrado em $pkg. Rode a instalação primeiro."; exit 1 }

Write-Output '== 1. Parando o JARVIS =='
foreach ($p in Get-Process JARVIS -ErrorAction SilentlyContinue) { Stop-Process -Id $p.Id -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
Write-Output "   restantes: $((Get-Process JARVIS -ErrorAction SilentlyContinue).Count)"

Write-Output '== 2. Removendo .next-staging e .next-old-* =='
if (Test-Path $stage) { Remove-Item $stage -Recurse -Force; Write-Output '   .next-staging removido' }
Get-ChildItem $pkg -Force -Directory -Filter '.next-old-*' | Remove-Item -Recurse -Force

Write-Output '== 3. Copiando .next (sem cache) e src =='
robocopy "$src\.next" "$pkg\.next" /MIR /XD "$src\.next\cache" /R:1 /W:1 /NFL /NDL /NC /NS /NP /NJH /NJS | Out-Null
Write-Output "   robocopy .next exit: $LASTEXITCODE"
robocopy "$src\src" "$pkg\src" /MIR /R:1 /W:1 /NFL /NDL /NC /NS /NP /NJH /NJS | Out-Null
Write-Output "   robocopy src exit: $LASTEXITCODE"
foreach ($f in 'package.json','tsconfig.json','next.config.ts','next-env.d.ts') {
  $from = Join-Path $src $f
  if (Test-Path $from) { Copy-Item $from (Join-Path $pkg $f) -Force }
}

Write-Output '== 4. Verificando byte a byte =='
$s = Get-ChildItem "$src\.next" -Recurse -File -Force | Where-Object { $_.FullName -notlike "$src\.next\cache*" }
$d = Get-ChildItem "$pkg\.next" -Recurse -File -Force | Where-Object { $_.FullName -notlike "$pkg\.next\cache*" }
$ss = ($s | Measure-Object Length -Sum).Sum; $ds = ($d | Measure-Object Length -Sum).Sum
Write-Output "   fonte: $($s.Count) arquivos $ss bytes | pacote: $($d.Count) arquivos $ds bytes"
Write-Output "   BUILD_ID fonte: $(Get-Content "$src\.next\BUILD_ID") | pacote: $(Get-Content "$pkg\.next\BUILD_ID")"

Write-Output '== 5. Fixando mtime de .next para o futuro (anti-auto-swap) =='
$future = (Get-Date).AddMinutes(5)
Get-ChildItem "$pkg\.next" -Recurse -File -Force | ForEach-Object { $_.LastWriteTime = $future }
Write-Output "   .next com mtime $future"

Write-Output '== 6. Junction de dados (recria se necessário) =='
$dataLink = Join-Path $pkg 'data'
if (-not (Get-Item $dataLink -Force -ErrorAction SilentlyContinue).LinkType) {
  if (Test-Path $dataLink) { Remove-Item $dataLink -Recurse -Force }
  New-Item -ItemType Junction -Path $dataLink -Target "$src\data" | Out-Null
  Write-Output '   junction recriada'
} else { Write-Output '   junction ok' }

if ($Launch) {
  Write-Output '== 7. Abrindo o JARVIS =='
  Start-Process $exe -ArgumentList '--no-sandbox'
  Start-Sleep -Seconds 18
  $l = Get-NetTCPConnection -LocalPort 3001 -State Listen -ErrorAction SilentlyContinue
  Write-Output "   3001: $(if ($l) { "LISTEN pid=$($l.OwningProcess)" } else { 'livre' })"
}

Write-Output 'Concluído.'
