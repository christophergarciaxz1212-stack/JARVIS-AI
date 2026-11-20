import fs from 'fs'
import os from 'os'
import path from 'path'
import type { Provider as LiveProvider } from '@/types'
import type { AIModel } from '@/types'
import type { ChatMessage, Completion } from '@/lib/agents/models'

export function tempProject(files: Record<string, string> = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-test-project-'))
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(dir, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, content)
  }
  return dir
}

function model(provider: string, raw: string): AIModel {
  return {
    id: `${provider}|${raw}`, name: raw, provider, providerName: provider, category: 'chat', contextWindow: 128000, maxTokens: 8192,
    free: true, multimodal: false, toolSupport: true, streaming: true, speed: 'fast', status: 'available',
  }
}

export function fakeProviders(): LiveProvider[] {
  return [
    { id: 'groq', name: 'Groq', icon: '', envKey: 'X', free: true, status: 'connected', models: [model('groq', 'openai/gpt-oss-120b'), model('groq', 'qwen/qwen3-32b'), model('groq', 'openai/gpt-oss-20b')] },
    { id: 'gemini', name: 'Gemini', icon: '', envKey: 'Y', free: true, status: 'connected', models: [model('gemini', 'gemini-3.5-flash-lite')] },
  ]
}

export const json = (o: unknown) => JSON.stringify(o)
export const act = (tool: string, args: Record<string, unknown>, thought = '') => json({ thought, actions: [{ tool, args }] })
export const acts = (...actions: Array<[string, Record<string, unknown>]>) => json({ thought: '', actions: actions.map(([tool, args]) => ({ tool, args })) })

/** Who is calling: the planner, or an agent working on task tN (read from the prompt). */
export function whoAmI(messages: ChatMessage[]) {
  const system = messages[0]?.content || ''
  if (system.includes('coordenador técnico')) return { kind: 'planner' as const }
  if (system.includes('relatório final')) return { kind: 'report' as const }
  if (system.includes('Responda a pergunta de um colega')) return { kind: 'answer' as const }
  const role = system.match(/^Você é .+? \((.+?)\)/)?.[1] || ''
  const task = messages[1]?.content.match(/# Sua tarefa: (t\d+)/)?.[1] || ''
  const step = messages.filter(m => m.role === 'assistant').length
  return { kind: 'agent' as const, role, task, step, last: messages[messages.length - 1]?.content || '' }
}

export function completion(text: string, model: string, latencyMs = 1): Completion {
  return { text, model, latencyMs, usage: { inputTokens: 100, outputTokens: 20 } }
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

export async function until(cond: () => boolean, timeoutMs = 8000) {
  const end = Date.now() + timeoutMs
  while (!cond()) {
    if (Date.now() > end) throw new Error('Timeout esperando condição')
    await sleep(10)
  }
}
