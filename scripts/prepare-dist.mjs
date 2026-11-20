/**
 * Prepara a staging de distribuição (release-staging/) — app instalável, autossuficiente.
 *
 * O que inclui: electron/, .next/ (SEM cache de build), node_modules apenas de
 * produção (+ electron para o empacotador), .env.local.example.
 * O que NÃO inclui: src/, tsconfig/tailwind/postcss (a instalação final não
 * compila nada — o usuário roda o build pronto), data/ (dados do usuário),
 * .env.local (chaves pessoais — jamais vão para um instalador).
 *
 * Uso: node scripts/prepare-dist.mjs
 */
import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const staging = path.join(root, 'release-staging')

const IGNORED_TOP = new Set(['node_modules', 'release-staging', 'release', 'data', '.git', '.next'])

const copy = (srcRel, dstRel, { filter } = {}) => {
  const src = path.join(root, srcRel)
  const dst = path.join(staging, dstRel)
  const stat = fs.statSync(src)
  if (stat.isDirectory()) {
    fs.mkdirSync(dst, { recursive: true })
    for (const name of fs.readdirSync(src)) {
      if (name === 'cache') continue // cache de build nunca vai para o instalador
      copy(path.join(srcRel, name), path.join(dstRel, name), { filter })
    }
  } else {
    if (filter && !filter(srcRel)) return
    fs.mkdirSync(path.dirname(dst), { recursive: true })
    fs.copyFileSync(src, dst)
  }
}

console.log('[dist] staging em', staging)
fs.rmSync(staging, { recursive: true, force: true })
fs.mkdirSync(staging, { recursive: true })

// 1. package.json: só deps de produção + electron (para o builder) + configuração do instalador
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const electronVersion = pkg.devDependencies?.electron
const distPkg = {
  name: pkg.name,
  version: pkg.version,
  description: 'JARVIS — agente pessoal de tecnologia com IA (chat multimodal, estúdio de vídeo, agentes)',
  author: 'JARVIS',
  license: 'UNLICENSED',
  private: true,
  main: 'electron/main.js',
  dependencies: pkg.dependencies || {},
  devDependencies: electronVersion ? { electron: String(require('electron/package.json').version) } : {},
  scripts: { start: 'electron --no-sandbox .' },
  build: {
    appId: 'ai.jarvis.desktop',
    productName: 'JARVIS AI',
    electronVersion: require('electron/package.json').version,
    asar: false,
    directories: { output: 'release', buildResources: 'build' },
    files: [
      'electron/**',
      '.next/**',
      'node_modules/**',
      'package.json',
      'next.config.js',
      '.env.local.example',
    ],
    asarUnpack: ['node_modules/next/dist/bin/next'],
    win: {
      target: [{ target: 'nsis', arch: ['x64'] }],
      icon: 'electron/icon-256.ico',
      artifactName: 'JARVIS-Setup-${version}.exe',
    },
    nsis: {
      oneClick: true,
      perMachine: false,
      allowToChangeInstallationDirectory: false,
      warningsAsErrors: false,
      createDesktopShortcut: true,
      createStartMenuShortcut: true,
      shortcutName: 'JARVIS AI',
      uninstallDisplayName: 'JARVIS AI',
      deleteAppDataOnUninstall: false,
    },
  },
}
fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify(distPkg, null, 2))
console.log('[dist] package.json de distribuição escrito')

// 2. Arquivos do app (a fonte do build pode ser outro diretório: JARVIS_DIST_DIR=.next-dist)
const distSrc = process.env.JARVIS_DIST_DIR || '.next'
if (!fs.existsSync(path.join(root, distSrc, 'BUILD_ID'))) {
  console.error(`[dist] ${distSrc} não está pronto (BUILD_ID ausente). Rode o build primeiro.`)
  process.exit(1)
}
copy('electron', 'electron')
copy(distSrc, '.next')
if (fs.existsSync(path.join(root, 'package-lock.json'))) {
  fs.copyFileSync(path.join(root, 'package-lock.json'), path.join(staging, 'package-lock.json'))
  console.log('[dist] package-lock.json copiado (npm ci exige)')
}
if (fs.existsSync(path.join(root, '.env.local.example'))) {
  fs.copyFileSync(path.join(root, '.env.local.example'), path.join(staging, '.env.local.example'))
}
// next.config.js puro (sem TypeScript): o pacote carrega com `next start` sem instalar nada.
// Mora em scripts/dist/: na raiz do projeto ele teria precedência sobre o next.config.ts.
fs.copyFileSync(path.join(root, 'scripts', 'dist', 'next.config.js'), path.join(staging, 'next.config.js'))
console.log('[dist] electron/ e .next/ copiados')

// (a poda de __image_snapshots__ roda DEPOIS do npm install — ver abaixo)

// 4. npm ci na staging (deps de produção + electron para o builder).
//    O npm desta máquina vive ao lado do executável do Node (Program Files), não no projeto.
const npmCli = path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')
console.log('[dist] instalando dependências de produção (npm install --omit=dev)…')
const ci = spawnSync(process.execPath, [npmCli, 'install', '--omit=dev', '--no-audit', '--no-fund'], { cwd: staging, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: false })
if (ci.status !== 0) {
  console.error(ci.stderr || ci.stdout)
  process.exit(1)
}
// 3b. Poda lixo de teste (fixtures de __image_snapshots__ do jimp etc.) —
//     NSIS usa API legada e falha em caminhos >260 chars; fixtures nunca são
//     carregadas em runtime.
const pruneDirs = ['__image_snapshots__']
const pruneDir = (dir) => {
  let entries = []
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
  for (const e of entries) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) {
      if (pruneDirs.includes(e.name)) { console.log('[dist] poda: %s', p.replace(root, '.')); fs.rmSync(p, { recursive: true, force: true }) } else pruneDir(p)
    }
  }
}
pruneDir(path.join(staging, 'node_modules'))
console.log('[dist] staging pronta:', staging)
console.log('[dist] próximo passo: npx electron-builder --project release-staging --win nsis')
