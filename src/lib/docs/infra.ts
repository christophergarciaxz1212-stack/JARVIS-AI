import os from 'os'
import fs from 'fs'
import { listExtensions } from '@/lib/engine/registry'
import { listJobs } from '@/lib/motion/jobs'
import { listConversations, listMemory } from '@/lib/db'
import type { ReportSection } from './generate'

const pct = (used: number, total: number) => (total > 0 ? ((used / total) * 100).toFixed(1) + ' %' : '—')
const gb = (bytes: number) => (bytes / 1e9).toFixed(1) + ' GB'
const dur = (ms: number) => {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  return `${d}d ${h}h ${m}min`
}

function diskSections(): ReportSection[] {
  const out: ReportSection[] = []
  try {
    const st = fs.statfsSync('C:\\')
    out.push({
      heading: 'Disco C:',
      body: `Total: ${gb(st.bsize * st.blocks)}\nLivre: ${gb(st.bsize * st.bfree)} (${((st.bfree / st.blocks) * 100).toFixed(1)} % livre)`,
    })
  } catch {
    out.push({ heading: 'Disco C:', body: 'Não foi possível medir o espaço livre a partir do Node neste sistema.' })
  }
  return out
}

function providerSection(): ReportSection {
  const env = process.env
  const keys: Array<[string, string]> = [
    ['GEMINI_API_KEY', 'Google Gemini'], ['GROQ_API_KEY', 'Groq'], ['OPENROUTER_API_KEY', 'OpenRouter'],
    ['CEREBRAS_API_KEY', 'Cerebras'], ['SAMBANOVA_API_KEY', 'SambaNova'], ['NVIDIA_API_KEY', 'NVIDIA NIM'],
    ['HUGGINGFACE_API_KEY', 'Hugging Face'], ['OPENAI_API_KEY', 'OpenAI'], ['ANTHROPIC_API_KEY', 'Anthropic'],
    ['DEEPSEEK_API_KEY', 'DeepSeek'],
  ]
  const connected = keys.filter(([k]) => !!env[k]).map(([, name]) => name)
  return {
    heading: 'Provedores de IA',
    body: connected.length
      ? `${connected.length} provedor(es) configurado(s):\n${connected.map(n => `- ${n}`).join('\n')}`
      : 'Nenhum provedor de IA configurado (nenhuma chave encontrada em .env.local / data/keys.json).',
  }
}

function engineSection(): ReportSection {
  let extensions = 0, enabled = 0, version = '—'
  try {
    const list = listExtensions()
    extensions = list.length
    enabled = list.filter(e => e.enabled && e.status !== 'disabled').length
    version = list[0]?.version || '—'
  } catch {}
  let toolCount = 0, mcpCount = 0, skillCount = 0
  try {
    const list = listExtensions()
    for (const e of list) {
      if (e.kind === 'tool') toolCount += e.tools.length
      else if (e.kind === 'mcp') mcpCount++
      else if (e.kind === 'skill') skillCount += e.skills?.length || 1
    }
  } catch {}
  return {
    heading: 'Skill Engine',
    body: [
      `Extensões instaladas: ${extensions} (${enabled} ativas)`,
      `Skills: ${skillCount} · Ferramentas: ${toolCount} · Servidores MCP: ${mcpCount}`,
      `Última versão instalada verificada: ${version}`,
    ].join('\n'),
  }
}

function motionSection(): ReportSection {
  let total = 0, done = 0, failed = 0
  try {
    const jobs = listJobs()
    total = jobs.length
    done = jobs.filter(j => j.status === 'done').length
    failed = jobs.filter(j => j.status === 'failed').length
  } catch {}
  return { heading: 'Estúdio Motion', body: `Vídeos gerados: ${done} de ${total} concluídos (${failed} com falha)` }
}

function memorySection(): ReportSection {
  let conversations = 0, messages = 0, memory = 0
  try { conversations = listConversations().length } catch {}
  try { memory = listMemory().length } catch {}
  return { heading: 'Dados e memória', body: `Conversas registradas: ${conversations}\nMemórias persistentes salvas: ${memory}` }
}

function miscSection(): ReportSection {
  const cpus = os.cpus()
  const load = os.loadavg()
  const net = Object.values(os.networkInterfaces()).flat().find(i => i && i.family === 'IPv4' && !i.internal)
  return {
    heading: 'Sistema operacional e rede',
    body: [
      `Plataforma: ${os.type()} ${os.release()} (${os.arch()})`,
      `Hostname: ${os.hostname()}${net ? `  ·  IP: ${net.address}` : ''}`,
      `CPU: ${cpus[0]?.model?.trim() || 'desconhecida'}  ·  ${cpus.length} núcleo(s)  ·  carga 1/5/15min: ${load.map(n => n.toFixed(2)).join(' / ')}`,
      `Memória: ${gb(os.totalmem())} total  ·  ${gb(os.freemem())} livre  ·  ${pct(os.totalmem() - os.freemem(), os.totalmem())} em uso`,
      `Uptime do sistema: ${dur(os.uptime() * 1000)}  ·  uptime do processo JARVIS: ${dur(process.uptime() * 1000)}`,
      `Node.js: ${process.version}  ·  ambiente: ${process.env.NODE_ENV || 'development'}`,
    ].join('\n'),
  }
}

/** Collects structured sections for the infrastructure report. */
export function collectInfraSections(): ReportSection[] {
  return [
    miscSection(),
    ...diskSections(),
    providerSection(),
    engineSection(),
    motionSection(),
    memorySection(),
  ]
}

/** Renders a deterministic Markdown summary for the chat reply. */
export function infraSummaryMarkdown(): string {
  const sections = collectInfraSections()
  const lines = ['**Relatório de infraestrutura gerado**\n']
  for (const s of sections) {
    lines.push(`### ${s.heading}`)
    lines.push(s.body)
    lines.push('')
  }
  return lines.join('\n')
}
