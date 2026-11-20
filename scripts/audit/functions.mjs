/**
 * Funções do JARVIS que passam pelo chat, com modelos reais: conversa no modelo padrão, modo
 * "melhor IA automática", topologia de rede (JSON + render), conselho de modelos e imagem.
 * Uso: node scripts/audit/functions.mjs [baseUrl]   (as conversas criadas são apagadas no fim)
 */
const base = process.argv[2] || 'http://127.0.0.1:3004'

async function chat(message, model) {
  const t = Date.now()
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message, model }), signal: AbortSignal.timeout(400_000),
  })
  const text = await res.text()
  let answer = '', error = '', conversationId, usedModel, fallbacks = []
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue
    try {
      const e = JSON.parse(line.slice(5).trim())
      if (e.type === 'chunk') answer += e.content || ''
      if (e.type === 'done') { conversationId = e.conversationId; usedModel = e.model }
      if (e.type === 'error') error = e.message
      if (e.type === 'status' && e.phase === 'fallback') fallbacks.push(`${e.from}: ${e.message}`.slice(0, 120))
      if (e.conversationId) conversationId ||= e.conversationId
    } catch {}
  }
  return { ms: Date.now() - t, answer, error, conversationId, usedModel, fallbacks, status: res.status }
}

const checks = [
  { name: 'conversa (modelo padrão)', msg: 'Em uma frase: para que serve um firewall?', model: undefined, ok: r => r.answer.length > 20 },
  { name: 'melhor IA automática', msg: 'Responda só com o resultado: quanto é 17 x 3?', model: 'auto', ok: r => /51/.test(r.answer) },
  { name: 'código (auto)', msg: 'Escreva uma função TypeScript curta que soma um array de números. Só o código.', model: 'auto', ok: r => /function|=>/.test(r.answer) },
  { name: 'topologia de rede (JSON + render)', msg: 'Crie uma topologia de rede com 1 roteador, 1 switch e 2 PCs na VLAN 10', model: undefined, ok: r => /\[\[topology:[\w-]+\]\]/.test(r.answer) },
  { name: 'conselho de modelos (/council)', msg: '/council Qual a capital da Austrália? Responda em uma palavra.', model: undefined, ok: r => /canberra/i.test(r.answer) },
  { name: 'imagem (melhora de prompt + geração grátis)', msg: 'gere uma imagem de um farol ao pôr do sol', model: undefined, ok: r => /\[\[image:|imagem|\.(png|jpg)/i.test(r.answer) && !r.error },
]

const created = []
let pass = 0
for (const c of checks) {
  let r
  try { r = await chat(c.msg, c.model) } catch (e) { r = { error: String(e?.message || e), answer: '', ms: 0, fallbacks: [] } }
  if (r.conversationId) created.push(r.conversationId)
  const ok = !r.error && c.ok(r)
  if (ok) pass++
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}  (${r.ms} ms${r.usedModel ? ` · ${r.usedModel}` : ''})${r.fallbacks?.length ? `  trocas: ${r.fallbacks.join(' ; ')}` : ''}`)
  console.log(`      ${r.error ? `ERRO: ${r.error}` : r.answer.replace(/\s+/g, ' ').slice(0, 160)}`)
}
for (const id of created) {
  try { await fetch(`${base}/api/conversations`, { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id }) }) } catch {}
}
console.log(`\n${pass}/${checks.length} funções OK`)
