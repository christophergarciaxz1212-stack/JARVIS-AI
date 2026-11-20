import { NextRequest } from 'next/server'
import { PROVIDER_APIS, chatProviders, TOOL_KEYS, ALLOWED_ENV_KEYS, getProviderModels, clearModelCache } from '@/lib/ai/providers'
import { saveKey, maskKey } from '@/lib/keys'
import { ensureCustomProviders } from '@/lib/ai/customProviders'

async function ollamaRunning() {
  try {
    const res = await fetch(`${process.env.OLLAMA_BASE_URL || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(1500) })
    return res.ok
  } catch {
    return false
  }
}

export async function GET() {
  ensureCustomProviders()
  // Paid providers are hidden while disabled; their saved keys stay untouched in keys.json
  const entries = [
    // Provedores cadastrados pelo usuário têm a própria seção (/api/providers)
    ...chatProviders().filter(p => !p.custom).map(p => ({ id: p.id, name: p.name, icon: p.icon, envKey: p.envKey, keyUrl: p.keyUrl, help: p.help, group: p.free ? 'free' : 'paid', mayBeKeyless: p.mayBeKeyless })),
    ...TOOL_KEYS.map(t => ({ id: t.id, name: t.name, icon: t.icon, envKey: t.envKey, keyUrl: t.keyUrl, help: t.help, group: 'tool', mayBeKeyless: false })),
  ].map(e => ({ ...e, configured: !!e.mayBeKeyless || !!process.env[e.envKey], hint: e.mayBeKeyless && !process.env[e.envKey] ? 'sem chave' : maskKey(process.env[e.envKey]) }))

  return Response.json({ entries, ollama: await ollamaRunning() })
}

async function testKey(envKey: string): Promise<{ ok: boolean; message: string }> {
  const key = process.env[envKey]
  if (!key) return { ok: false, message: 'Nenhuma chave salva' }

  try {
    const tool = TOOL_KEYS.find(t => t.envKey === envKey)
    if (tool) {
      await tool.verify(key)
      return { ok: true, message: 'Chave funcionando' }
    }
    const p = PROVIDER_APIS.find(x => x.envKey === envKey)!
    await p.verify?.(key)
    const models = await getProviderModels(p, { fresh: true })
    const free = models.filter(m => m.free).length
    const detail = p.free && free !== models.length ? ` (${free} grátis)` : ''
    return { ok: true, message: `Conectado · ${models.length} modelos disponíveis${detail}` }
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Falha no teste' }
  }
}

export async function POST(req: NextRequest) {
  let body: { action: 'save' | 'test' | 'remove'; envKey: string; value?: string }
  try {
    body = await req.json()
  } catch {
    return Response.json({ ok: false, message: 'Corpo inválido (JSON esperado)' }, { status: 400 })
  }
  const { action, envKey, value } = body

  if (typeof envKey !== 'string' || !ALLOWED_ENV_KEYS.has(envKey)) {
    return Response.json({ ok: false, message: 'Chave desconhecida' }, { status: 400 })
  }
  if (action !== 'save' && action !== 'test' && action !== 'remove') {
    return Response.json({ ok: false, message: 'Ação inválida' }, { status: 400 })
  }

  // Catalog no longer exports invalidateCatalog(); clear every provider's model cache instead
  for (const p of PROVIDER_APIS) clearModelCache(p.id)

  try {
    if (action === 'remove') {
      saveKey(envKey, '')
      return Response.json({ ok: true, message: 'Chave removida' })
    }

    if (action === 'save') {
      const clean = (value || '').trim()
      if (!clean || clean.length > 1000 || /\s/.test(clean)) {
        return Response.json({ ok: false, message: 'Cole a chave completa, sem espaços' }, { status: 400 })
      }
      saveKey(envKey, clean)
    }

    return Response.json(await testKey(envKey))
  } catch {
    return Response.json({ ok: false, message: 'Falha ao salvar — veja as permissões da pasta data/' }, { status: 500 })
  }
}
