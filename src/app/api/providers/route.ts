import { NextRequest } from 'next/server'
import {
  PROVIDER_PRESETS, discoverModels, ensureCustomProviders, envKeyFor, publicView, readCustomProviders,
  removeCustomProvider, upsertCustomProvider, type ApiStyle,
} from '@/lib/ai/customProviders'
import { PROVIDER_APIS, getProviderModels, SEP } from '@/lib/ai/providers'
import { completeOnce } from '@/lib/ai/client'
import { recordModelTest } from '@/lib/ai/modelTests'
import { connectProvider } from '@/lib/ai/connectProvider'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) => Response.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status })

async function withModels(id: string) {
  ensureCustomProviders()
  const api = PROVIDER_APIS.find(p => p.id === id)
  if (!api) return { models: [] as string[], error: 'Provedor não registrado' }
  try {
    const models = await getProviderModels(api, { fresh: true })
    return { models: models.map(m => m.id.slice(m.id.indexOf(SEP) + 1)), error: '' }
  } catch (e) {
    return { models: [] as string[], error: (e as Error).message }
  }
}

export async function GET() {
  ensureCustomProviders()
  return Response.json({ providers: readCustomProviders().map(publicView), presets: PROVIDER_PRESETS })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { return fail('Corpo inválido (JSON esperado)') }
  try {
    switch (String(body.action || '')) {
      // Só URL + chave: descobre formato, endereço, cabeçalho e TODOS os modelos, salva e testa
      case 'connect': {
        const r = await connectProvider({
          baseUrl: String(body.baseUrl || ''),
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : '',
          name: typeof body.name === 'string' ? body.name : undefined,
          model: typeof body.model === 'string' ? body.model : undefined,
          signal: req.signal,
        })
        return Response.json({ ok: true, provider: publicView(r.provider), models: r.models, test: r.test, detected: r.detected })
      }
      // Todos os modelos que a API de um provedor salvo oferece agora
      case 'models': {
        const id = String(body.id || '')
        ensureCustomProviders()
        const cp = readCustomProviders().find(p => p.id === id)
        if (!cp) return fail('Provedor não encontrado', 404)
        const r = await discoverModels(cp.baseUrl, cp.style, process.env[envKeyFor(id)] || '', cp.auth)
        return Response.json({ ok: true, models: r.models })
      }
      // Lista os modelos de um endereço antes de salvar (a chave digitada não é guardada aqui)
      case 'discover': {
        const style: ApiStyle = body.style === 'anthropic' ? 'anthropic' : 'openai'
        const typed = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
        const stored = typeof body.id === 'string' ? process.env[envKeyFor(body.id)] || '' : ''
        const r = await discoverModels(String(body.baseUrl || ''), style, typed || stored)
        return Response.json({ ok: true, baseUrl: r.baseUrl, models: r.models })
      }
      case 'save': {
        const cp = upsertCustomProvider({
          id: typeof body.id === 'string' && body.id ? body.id : undefined,
          name: String(body.name || ''),
          baseUrl: String(body.baseUrl || ''),
          style: body.style === 'anthropic' ? 'anthropic' : 'openai',
          apiKey: typeof body.apiKey === 'string' ? body.apiKey : undefined,
          manualModels: Array.isArray(body.manualModels) ? body.manualModels.map(String) : String(body.manualModels || ''),
          freeOnly: body.freeOnly !== false,
        })
        const listed = await withModels(cp.id)
        return Response.json({ ok: true, provider: publicView(cp), models: listed.models, modelsError: listed.error })
      }
      // Conversa de verdade com um modelo do provedor: só passa se acertar a conta
      case 'test': {
        const id = String(body.id || '')
        ensureCustomProviders()
        if (!readCustomProviders().some(p => p.id === id)) return fail('Provedor não encontrado', 404)
        let model = typeof body.model === 'string' ? body.model : ''
        if (!model) {
          const listed = await withModels(id)
          if (!listed.models.length) return fail(listed.error || 'Nenhum modelo para testar')
          model = listed.models[0]
        }
        const fullId = `${id}${SEP}${model}`
        const t0 = Date.now()
        // Servidor no próprio PC/rede carrega o modelo na GPU antes de responder: espera mais
        const cp = readCustomProviders().find(p => p.id === id)!
        const local = /^https?:\/\/(localhost|127\.|\[::1\]|192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(cp.baseUrl)
        const limitMs = local ? 180_000 : 60_000
        try {
          const { text } = await completeOnce(fullId, [{ role: 'user', content: 'Quanto é 7+5? Responda só com o número.' }], AbortSignal.timeout(limitMs))
          const ms = Date.now() - t0
          const ok = /\b12\b/.test(text)
          // Errar a conta uma vez não esconde o modelo; só respostas certas e falhas reais ficam registradas
          if (ok) recordModelTest(fullId, { ok: true, ms })
          return Response.json({ ok, model, latencyMs: ms, answer: text.slice(0, 200), error: ok ? '' : 'O modelo respondeu, mas errou a conta (7+5)' })
        } catch (e) {
          const ms = Date.now() - t0
          // Estourar o prazo do teste não prova que o modelo é ruim (pode estar carregando): não registra
          if (ms >= limitMs - 500) return Response.json({ ok: false, model, latencyMs: ms, error: `não respondeu em ${limitMs / 1000} s${local ? ' (o modelo pode estar carregando na GPU — tente de novo)' : ''}` })
          recordModelTest(fullId, { ok: false, error: (e as Error).message })
          return Response.json({ ok: false, model, latencyMs: ms, error: (e as Error).message })
        }
      }
      case 'remove': {
        removeCustomProvider(String(body.id || ''))
        return Response.json({ ok: true })
      }
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
