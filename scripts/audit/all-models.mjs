/**
 * Testa TODOS os modelos do catálogo (e os ocultos por falha recente, para darem nova chance) nas três
 * capacidades que o JARVIS usa: resposta simples, streaming (chat) e JSON (agentes, roteiro de vídeo,
 * Hub, topologias). O resultado é gravado pelo próprio servidor em data/model-tests.json e passa a
 * guiar a escolha de modelo de cada função.
 * Uso: node scripts/audit/all-models.mjs [baseUrl] [saida.json]
 * Provedores rodam em paralelo; dentro de cada provedor, um modelo por vez (limites das cotas grátis).
 */
import fs from 'node:fs'
import path from 'node:path'

const base = process.argv[2] || 'http://127.0.0.1:3004'
const out = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3] : '.tmp/all-models.json'
const dataDir = process.env.JARVIS_DATA_DIR || path.join(process.cwd(), 'data')
const sleep = ms => new Promise(r => setTimeout(r, ms))

const catalog = await (await fetch(`${base}/api/models?refresh=1`, { signal: AbortSignal.timeout(180_000) })).json()
const connected = (catalog.providers || []).filter(p => p.status === 'connected')
const byProvider = new Map(connected.map(p => [p.id, p.models.map(m => m.id)]))

// Ocultos por falha "permanente" recente também são re-testados (cotas voltam, modelos voltam)
let hidden = 0
try {
  const tests = JSON.parse(fs.readFileSync(path.join(dataDir, 'model-tests.json'), 'utf8'))
  for (const [id, t] of Object.entries(tests)) {
    const provider = id.split('|')[0]
    if (!t.ok && t.kind && t.kind !== 'temporary' && byProvider.has(provider) && !byProvider.get(provider).includes(id)) {
      byProvider.get(provider).push(id)
      hidden++
    }
  }
} catch { /* sem histórico */ }

// --only=a,b : re-testa só esses modelos; --gap=ms : pausa entre modelos do mesmo provedor
const only = (process.argv.find(a => a.startsWith('--only=')) || '').slice(7).split(',').filter(Boolean)
const gapMs = Number((process.argv.find(a => a.startsWith('--gap=')) || '').slice(6)) || 1500
if (only.length) {
  for (const [p, ids] of byProvider) byProvider.set(p, [...new Set([...ids, ...only.filter(id => id.startsWith(`${p}|`))])].filter(id => only.includes(id)))
}
const total = [...byProvider.values()].reduce((s, l) => s + l.length, 0)
console.log(`${connected.length} provedores conectados · ${total} modelos (${hidden} estavam ocultos) · ${base}`)
const results = []
let done = 0

async function runProvider(provider, ids) {
  for (const id of ids) {
    const started = Date.now()
    let r
    try {
      const res = await fetch(`${base}/api/models`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ modelId: id, provider, full: true }),
        signal: AbortSignal.timeout(420_000),
      })
      r = await res.json()
    } catch (e) { r = { success: false, error: String(e?.message || e) } }
    const row = { id, provider, ok: !!r.success, ms: r.latencyMs ?? Date.now() - started, stream: r.caps?.stream, json: r.caps?.json, kind: r.kind, error: r.error, capErrors: r.capErrors }
    results.push(row)
    done++
    const mark = v => (v === true ? '✓' : v === false ? '✗' : '?')
    console.log(`[${done}/${total}] ${row.ok ? 'OK  ' : 'FALHA'} ${id}  ${row.ok ? `${row.ms}ms stream ${mark(row.stream)} json ${mark(row.json)}` : `${row.kind || ''} ${String(row.error).slice(0, 140)}`}`)
    await sleep(provider === 'ollama' ? 0 : gapMs)
  }
}

await Promise.all([...byProvider.entries()].map(([p, ids]) => runProvider(p, ids)))

const ok = results.filter(r => r.ok)
const full = ok.filter(r => r.stream && r.json)
const summary = {
  ranAt: new Date().toISOString(), base, total, hiddenRetested: hidden,
  ok: ok.length, fullyCapable: full.length,
  noStream: ok.filter(r => r.stream === false).map(r => r.id),
  noJson: ok.filter(r => r.json === false).map(r => r.id),
  failedByKind: results.filter(r => !r.ok).reduce((acc, r) => { (acc[r.kind || 'outro'] ||= []).push(r.id); return acc }, {}),
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, JSON.stringify({ summary, results }, null, 2))
console.log(`\n${ok.length}/${total} respondem · ${full.length} fazem tudo (streaming + JSON) → ${out}`)
console.log(JSON.stringify(summary, null, 1))
