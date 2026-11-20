import fs from 'fs'
import path from 'path'
import type { Finding, RiskLevel, ScanReport } from './types'

interface Rule {
  id: string
  severity: Finding['severity']
  re: RegExp
  message: string
}

// Static rules run on every text file before anything is installed or executed
const RULES: Rule[] = [
  { id: 'pipe-to-shell', severity: 'critical', re: /(curl|wget|iwr|Invoke-WebRequest|irm|Invoke-RestMethod)\b[^\n|]{0,240}\|\s*(sh|bash|zsh|iex|Invoke-Expression|powershell|pwsh)\b/i, message: 'Baixa e executa código da internet direto no shell' },
  { id: 'encoded-powershell', severity: 'critical', re: /(powershell|pwsh)(\.exe)?\b[^\n]{0,120}\s-(e|enc|encodedcommand)\s+[A-Za-z0-9+/=]{24,}/i, message: 'PowerShell com comando codificado (ofuscação)' },
  { id: 'obfuscated-eval', severity: 'critical', re: /\b(eval|new\s+Function)\s*\(\s*(atob|Buffer\.from|unescape|decodeURIComponent|String\.fromCharCode)/i, message: 'Executa código decodificado em tempo de execução (ofuscação)' },
  { id: 'crypto-miner', severity: 'critical', re: /\b(xmrig|stratum\+tcp|cryptonight|minerd|coinhive)\b/i, message: 'Indícios de minerador de criptomoeda' },
  { id: 'credential-theft', severity: 'critical', re: /(\.ssh[\\/]+id_(rsa|ed25519)|\.aws[\\/]+credentials|Login Data|wallet\.dat|Local State[^\n]{0,80}os_crypt|\\Cookies\b|keychain-db|\\Network\\Cookies)/i, message: 'Acessa arquivos de credenciais, cookies ou carteiras' },
  { id: 'persistence', severity: 'critical', re: /(CurrentVersion\\Run\b|schtasks(\.exe)?\s+\/create|Set-MpPreference\s+-Disable|Add-MpPreference\s+-Exclusion|reg(\.exe)?\s+add\s+HK(LM|CU)\\[^\n]*\\Run)/i, message: 'Tenta iniciar sozinho com o Windows ou desativar o antivírus' },
  { id: 'destructive', severity: 'critical', re: /(rm\s+-rf\s+(\/|~)(\s|$|")|format\s+c:|del\s+\/[sqf]+\s+c:\\|Remove-Item\s+-Recurse\s+-Force\s+["']?C:\\(Windows|Users)?["']?\s*$)/im, message: 'Comando destrutivo para o sistema' },
  { id: 'exfil-webhook', severity: 'high', re: /(discord(app)?\.com\/api\/webhooks|api\.telegram\.org\/bot\d+:|pastebin\.com\/api|ngrok\.io|requestbin)/i, message: 'Envia dados para webhook/serviço de coleta externo' },
  { id: 'remote-exec', severity: 'medium', re: /(child_process|subprocess)[\s\S]{0,400}(https?:\/\/)[\s\S]{0,200}(exec|spawn|Popen|system)\s*\(/i, message: 'Executa comandos combinando downloads da internet' },
  { id: 'embedded-private-key', severity: 'critical', re: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/i, message: 'Chave privada embutida no pacote' },
  { id: 'embedded-cloud-key', severity: 'high', re: /\b(AKIA[0-9A-Z]{16}|ASIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}|sk-(?:proj-|ant-)?[A-Za-z0-9_-]{24,}|xox[baprs]-[A-Za-z0-9-]{20,}|AIza[0-9A-Za-z_-]{30,})\b/, message: 'Credencial real embutida no código (pode vazar para terceiros)' },
  { id: 'env-dump', severity: 'high', re: /(JSON\.stringify\s*\(\s*process\.env\s*\)|Object\.entries\s*\(\s*process\.env\s*\)[\s\S]{0,200}(fetch|axios|https?\.request)|dict\s*\(\s*os\.environ\s*\)[\s\S]{0,200}(requests\.|urllib|httpx))/i, message: 'Coleta e envia todo o ambiente (credenciais) para fora' },
]

const BINARY_EXT = new Set(['.exe', '.dll', '.scr', '.msi', '.com', '.bin', '.so', '.dylib', '.node', '.sys', '.vbs', '.jar'])
const SCRIPT_EXT = new Set(['.ps1', '.bat', '.cmd', '.sh'])
const TEXT_EXT = new Set(['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts', '.jsx', '.tsx', '.py', '.json', '.md', '.ps1', '.bat', '.cmd', '.sh', '.yml', '.yaml', '.toml', '.txt', '.html', '.go', '.rs', '.rb', '.php'])
const SKIP_DIRS = new Set(['node_modules', '.git', '__pycache__', '.venv', 'venv', 'dist-test'])

const NETWORK = /\b(fetch\s*\(|axios\b|https?\.(request|get)\s*\(|new\s+WebSocket\b|requests\.(get|post|put|delete)|urllib|httpx\b|aiohttp\b|undici\b)/
const SHELL = /\b(child_process|execSync|spawnSync|spawn\s*\(|execFile\s*\(|subprocess\.|os\.system\s*\(|Start-Process)\b/
const FS_WRITE = /\b(writeFileSync|writeFile\s*\(|appendFile|createWriteStream|fs\.rm|unlinkSync|rmSync|mkdirSync|open\([^)]*['"]w|Set-Content|Out-File)\b/
const ENV_REFS = [
  /process\.env\.([A-Z][A-Z0-9_]{2,})/g,
  /process\.env\[['"]([A-Z][A-Z0-9_]{2,})['"]\]/g,
  /os\.environ(?:\.get)?\(?\[?['"]([A-Z][A-Z0-9_]{2,})['"]/g,
  /os\.getenv\(\s*['"]([A-Z][A-Z0-9_]{2,})['"]/g,
]
const COMMON_ENV = new Set(['NODE_ENV', 'HOME', 'PATH', 'USERPROFILE', 'APPDATA', 'TEMP', 'TMP', 'DEBUG', 'PORT', 'HOST', 'LOG_LEVEL', 'CI', 'SHELL', 'TERM', 'LANG', 'PWD'])

const ORDER: Record<Finding['severity'], number> = { info: 0, medium: 1, high: 2, critical: 3 }

/**
 * A critical string inside a comment or prose that explicitly tells humans NOT to do
 * the dangerous thing ("Never run its `curl | sh`", "~/.ssh/id_rsa must not be read")
 * is still suspicious, but it is not the attack itself. It is downgraded to `medium`
 * (the user decides) instead of auto-blocking the package.
 * Real attacks hide in code, not in comments telling you not to run them.
 */
const DEFENSIVE = /\b(never|não|nao|not\b|nunca|jamais|don't|do not|refus|avoid|prevent|protec|defens|rejeit|recus|deny|denylist|forbid|block|banned|ban|negado|negar|bloqueio|bloquear|proibido|except|whitelist|allow-?list)\w*/i
const COMMENT_LINE = /^\s*(\/\/|\/\*|\*|#|<!--|;|--|REM\b)/i
// Placeholders the world agrees are examples — AWS documentation uses these exact strings
const KNOWN_PLACEHOLDERS = new Set(['AKIAIOSFODNN7EXAMPLE', 'ASIAIOSFODNN7EXAMPLE'])
const DEMOTE_RULES = new Set(['pipe-to-shell', 'credential-theft', 'embedded-private-key', 'embedded-cloud-key'])

/** Test fixtures for secret detectors are made of fake secrets — they are never live credentials */
const TEST_FILE = /(^|[/\\])tests?[/\\]|[/\\]test_[^/\\]*\.(py|js|mjs|ts|cjs)$|\.test\.(js|mjs|ts|jsx|tsx)$/i

function demoteSeverity(base: Finding['severity']): Finding['severity'] {
  return base === 'critical' || base === 'high' ? 'medium' : base
}

export function levelOf(findings: Finding[]): RiskLevel {
  const max = Math.max(0, ...findings.map(f => ORDER[f.severity]))
  return max >= 3 ? 'critical' : max === 2 ? 'high' : max === 1 ? 'medium' : 'low'
}

/** Static analysis of a downloaded extension. Nothing in `dir` is executed. */
export function scanDirectory(dir: string): ScanReport {
  const findings: Finding[] = []
  const inferred = { network: false, shell: false, fsWrite: false, envVars: [] as string[] }
  const env = new Set<string>()
  let files = 0
  let bytes = 0

  const walk = (d: string) => {
    if (files > 4000) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(d, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      const abs = path.join(d, e.name)
      const rel = path.relative(dir, abs).split(path.sep).join('/')
      if (e.isSymbolicLink()) { findings.push({ severity: 'high', rule: 'symlink', message: 'Link simbólico dentro do pacote', file: rel }); continue }
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(abs); continue }
      files++
      const ext = path.extname(e.name).toLowerCase()
      let size = 0
      try { size = fs.statSync(abs).size } catch { continue }
      bytes += size
      if (BINARY_EXT.has(ext)) { findings.push({ severity: 'high', rule: 'binary', message: `Arquivo executável/binário (${ext})`, file: rel }); continue }
      if (SCRIPT_EXT.has(ext)) findings.push({ severity: 'info', rule: 'script', message: `Script ${ext} (será analisado, nunca executado na instalação)`, file: rel })
      if (!TEXT_EXT.has(ext) && ext !== '' || size > 2_000_000) continue

      let text: string
      try { text = fs.readFileSync(abs, 'utf-8') } catch { continue }
      if (text.includes('\u0000')) continue

      if (e.name === 'package.json') {
        try {
          const pkg = JSON.parse(text) as { scripts?: Record<string, string> }
          for (const hook of ['preinstall', 'install', 'postinstall', 'prepare']) {
            if (pkg.scripts?.[hook]) findings.push({ severity: 'medium', rule: 'install-script', message: `Script de instalação "${hook}" (não será executado: instalação usa --ignore-scripts)`, file: rel })
          }
        } catch {}
      }

      const lines = text.split('\n')
      for (const rule of RULES) {
        const m = rule.re.exec(text)
        if (!m) continue
        const matched = m[0]
        const line = text.slice(0, m.index).split('\n').length
        const lineText = lines[line - 1] || ''
        let severity = rule.severity
        let message = rule.message
        // Placeholder credentials that are not secrets by definition (AWS documentation, test fixtures)
        if (rule.id === 'embedded-cloud-key' && KNOWN_PLACEHOLDERS.has(m[0])) {
          continue
        }
        // Test fixtures for secret detectors hold fake secrets on purpose
        if (TEST_FILE.test(rel) && (rule.id === 'embedded-private-key' || rule.id === 'embedded-cloud-key')) {
          findings.push({ severity: 'medium', rule: rule.id, message: `${rule.message} (fixture de teste — de propósito, não é credencial real)`, file: rel, line })
          continue
        }
        // Defensive context: the comment/prose around the match says "don't do this".
        // Docs/configs (markdown, txt, yaml, json) are policy as a whole, so we accept a
        // defensive halo ANYWHERE in the file — the surrounding text is instructions too.
        // Findings never drop below 'medium' (the user approves explicitly).
        const docExt = ext === '.md' || ext === '.txt' || ext === '.yml' || ext === '.yaml' || ext === '.json'
        const halo = docExt ? text : lines.slice(Math.max(0, line - 4), line).join('\n')
        const inDocOrComment =
          ext === '.md' || ext === '.txt' || ext === '.yml' || ext === '.yaml' || ext === '.json' ||
          COMMENT_LINE.test(lineText) || COMMENT_LINE.test(lines[line - 2] || '') || COMMENT_LINE.test(lines[line - 3] || '') || COMMENT_LINE.test(lines[line - 4] || '')
        if (
          DEMOTE_RULES.has(rule.id) &&
          DEFENSIVE.test(halo) &&
          inDocOrComment
        ) {
          severity = demoteSeverity(rule.severity)
          message = `${rule.message} (contexto defensivo — o texto pede para NÃO fazer isso)`
        }
        findings.push({ severity, rule: rule.id, message, file: rel, line })
      }
      if (lines.some(l => l.length > 6000 && (l.match(/\\x[0-9a-f]{2}|_0x[0-9a-f]{4}/gi)?.length || 0) > 200)) {
        findings.push({ severity: 'high', rule: 'obfuscation', message: 'Código minificado/ofuscado de forma suspeita', file: rel })
      }
      if (/\.(js|mjs|cjs|ts|py|mts|cts)$/.test(ext)) {
        if (NETWORK.test(text)) inferred.network = true
        if (SHELL.test(text)) inferred.shell = true
        if (FS_WRITE.test(text)) inferred.fsWrite = true
        for (const re of ENV_REFS) for (const m of text.matchAll(re)) if (!COMMON_ENV.has(m[1])) env.add(m[1])
      }
    }
  }
  walk(dir)

  inferred.envVars = [...env].sort().slice(0, 40)
  if (inferred.shell) findings.push({ severity: 'info', rule: 'uses-shell', message: 'Executa programas/comandos do sistema' })
  if (inferred.network) findings.push({ severity: 'info', rule: 'uses-network', message: 'Acessa a internet' })
  if (inferred.envVars.length) findings.push({ severity: 'info', rule: 'uses-env', message: `Lê variáveis de ambiente: ${inferred.envVars.join(', ')}` })

  return { level: levelOf(findings), findings: dedupe(findings), inferred, files, bytes, scannedAt: Date.now() }
}

function dedupe(findings: Finding[]) {
  const seen = new Set<string>()
  return findings.filter(f => {
    const k = `${f.rule}|${f.file || ''}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  }).sort((a, b) => ORDER[b.severity] - ORDER[a.severity]).slice(0, 80)
}

/** Repository/package metadata signals added to a scan. */
export function metadataFindings(meta: { stars?: number; archived?: boolean; license?: string; createdAt?: string; updatedAt?: string }): Finding[] {
  const out: Finding[] = []
  if (meta.archived) out.push({ severity: 'medium', rule: 'archived', message: 'Repositório arquivado (sem manutenção)' })
  if (meta.stars !== undefined && meta.stars < 3) out.push({ severity: 'medium', rule: 'low-reputation', message: `Pouca reputação (${meta.stars} estrelas)` })
  if (meta.createdAt && Date.now() - Date.parse(meta.createdAt) < 14 * 86400_000) out.push({ severity: 'medium', rule: 'very-new', message: 'Repositório criado há menos de 14 dias' })
  if (!meta.license) out.push({ severity: 'info', rule: 'no-license', message: 'Sem licença declarada' })
  return out
}
