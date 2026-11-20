/**
 * JARVIS model battery — probes every configured provider end-to-end and writes a report.
 * Usage: node scripts/model-battery.mjs [baseUrl] [outFile]
 * Defaults: baseUrl http://127.0.0.1:3100, outFile .tmp/battery.json
 * The chat probes create real conversations in the JARVIS database; the script deletes them at the end.
 */
import { writeFileSync, mkdirSync, rmSync } from 'fs'
import { dirname } from 'path'

const base = process.argv[2] || 'http://127.0.0.1:3100'
const out = process.argv[3] || '.tmp/battery.json'

async function api(path, opts = {}) {
  const res = await fetch(`${base}${path}`, {
    signal: AbortSignal.timeout(opts.timeout ?? 120_000),
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
  })
  return res
}

async function testModel(modelId, provider) {
  const started = Date.now()
  try {
    const res = await api('/api/models', {
      method: 'POST',
      body: JSON.stringify({ modelId, provider }),
      timeout: 120_000,
    })
    const j = await res.json()
    return { success: !!j.success, latencyMs: j.latencyMs ?? Date.now() - started, reply: (j.reply || '').slice(0, 80), error: j.error }
  } catch (e) {
    return { success: false, latencyMs: Date.now() - started, error: String(e?.message || e) }
  }
}

async function chatOnce(model, content) {
  const started = Date.now()
  let conversationId
  try {
    const res = await api('/api/chat', {
      method: 'POST',
      body: JSON.stringify({ message: content, model }),
      timeout: 180_000,
    })
    const text = await res.text()
    const lines = text.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim())
    let answer = ''
    let done = false
    let error = ''
    for (const l of lines) {
      try {
        const evt = JSON.parse(l)
        if (evt.type === 'chunk') answer += evt.content || ''
        if (evt.type === 'done') { done = true; conversationId = evt.conversationId }
        if (evt.type === 'error') error = evt.message || 'error'
      } catch {}
    }
    return { success: done && !error, latencyMs: Date.now() - started, reply: answer.replace(/\s+/g, ' ').slice(0, 120), error: error || undefined, conversationId }
  } catch (e) {
    return { success: false, latencyMs: Date.now() - started, error: String(e?.message || e) }
  }
}

async function deleteConversation(id) {
  if (!id) return
  try { await api('/api/conversations', { method: 'DELETE', body: JSON.stringify({ id }), timeout: 15_000 }) } catch {}
}

const results = { base, ranAt: new Date().toISOString(), checks: [] }
const check = (name, data) => { results.checks.push({ name, ...data }); console.log(`${data.success ? 'PASS' : 'FAIL'}  ${name}  (${data.latencyMs ?? '-'}ms)${data.error ? '  — ' + data.error : ''}`) }

// 1. Catalog probe
const started = Date.now()
const catalogRes = await api('/api/models', { timeout: 120_000 })
const catalog = await catalogRes.json()
const providers = (catalog.providers || []).map(p => ({ id: p.id, status: p.status, models: p.models.length }))
check('catálogo vivo', { success: catalogRes.ok && providers.length > 0, latencyMs: Date.now() - started, summary: catalog.summary, defaultModel: catalog.defaultModel, providers })

// 2-6. Provider/model tests (free only — paid providers are being removed)
const defaultModel = catalog.defaultModel || ''
const ranked = async (q) => {
  const res = await api('/api/models', { method: 'POST', body: JSON.stringify({ rankFor: q }), timeout: 120_000 })
  return res.json()
}
const codeRank = await ranked('refatorar bug typescript')
const chatRank = await ranked('responda rápido')
check('rankFor=code', { success: !!codeRank.best, best: codeRank.best, candidates: codeRank.candidates })
check('rankFor=chat', { success: !!chatRank.best, best: chatRank.best, candidates: chatRank.candidates })

const ollamaModels = (catalog.providers || []).find(p => p.id === 'ollama')?.models || []
for (const m of ollamaModels) {
  check(`test ${m.id}`, await testModel(m.id, 'ollama'))
}
check(`test ${defaultModel}`, await testModel(defaultModel, defaultModel.split('|')[0]))
const groq = (catalog.providers || []).find(p => p.id === 'groq')?.models || []
for (const m of groq.slice(0, 4)) check(`test ${m.id}`, await testModel(m.id, 'groq'))
// OpenRouter: test only the first 3 free models to stay inside rate limits
const orFree = ((catalog.providers || []).find(p => p.id === 'openrouter')?.models || []).filter(m => m.free).slice(0, 3)
for (const m of orFree) check(`test ${m.id}`, await testModel(m.id, 'openrouter'))

// 9-11. Chat end-to-end (SSE), then cleanup the conversations created
const p1 = await chatOnce('groq|openai/gpt-oss-120b', 'Responda apenas com a palavra: ok')
check('chat groq|openai/gpt-oss-120b', p1)
await deleteConversation(p1.conversationId)
const ollamaDefault = ollamaModels[0]?.id
if (ollamaDefault) {
  const p2 = await chatOnce(ollamaDefault, 'Responda apenas com a palavra: ok')
  check(`chat ${ollamaDefault}`, p2)
  await deleteConversation(p2.conversationId)
}
const p3 = await chatOnce('auto', 'Responda apenas com a palavra: ok')
check('chat auto (melhor IA automática)', p3)
await deleteConversation(p3.conversationId)

mkdirSync(dirname(out), { recursive: true })
writeFileSync(out, JSON.stringify(results, null, 2))
const pass = results.checks.filter(c => c.success).length
console.log(`\n${pass}/${results.checks.length} checks passed → ${out}`)
