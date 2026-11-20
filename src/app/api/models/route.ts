import { NextRequest } from 'next/server'
import { defaultModelFrom, detectTask, getLiveCatalog, rankModels, testProviderModel } from '@/lib/ai/catalog'
import { readModelTests } from '@/lib/ai/modelTests'

/** Catálogo ao vivo: cada provedor é sondado na própria API. */
export async function GET(req: NextRequest) {
  const refresh = new URL(req.url).searchParams.get('refresh') === '1'
  try {
    const providers = await getLiveCatalog(refresh)
    const total = providers.reduce((sum, p) => sum + p.models.length, 0)
    // Testes anteriores desta máquina: o painel de modelos mostra "⚡ 426ms" nos que já responderam
    const persisted = readModelTests()
    const tests: Record<string, { ok: boolean; ms?: number; at: number }> = {}
    for (const [id, t] of Object.entries(persisted)) {
      if (t.ok && typeof t.ms === 'number') tests[id] = { ok: true, ms: t.ms, at: t.at }
    }
    return Response.json({
      providers,
      defaultModel: defaultModelFrom(providers),
      fetchedAt: new Date().toISOString(),
      tests,
      summary: {
        total,
        free: providers.flatMap(p => p.models).filter(m => m.free).length,
        connected: providers.filter(p => p.status === 'connected').length,
      },
    })
  } catch (error) {
    return Response.json(
      { providers: [], error: String((error as Error).message) },
      { status: 500 }
    )
  }
}

/** Testa um modelo de qualquer provedor (não só Gemini/Groq). */
export async function POST(req: NextRequest) {
  try {
    const { modelId, provider, rankFor, warm, full } = await req.json()

    // Loads a local model into the GPU when it is chosen (Ollama: /api/generate without a prompt), so the
    // first message does not pay the seconds of loading. Fire and forget: the answer does not wait for it.
    if (typeof warm === 'string' && /^ollama\|[\w.:/-]+$/.test(warm)) {
      const base = process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434'
      fetch(`${base}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: warm.slice('ollama|'.length), keep_alive: process.env.OLLAMA_KEEP_ALIVE || '30m' }),
      }).catch(() => {})
      return Response.json({ warming: true })
    }

    if (rankFor) {
      const providers = await getLiveCatalog()
      const ranked = rankModels(providers, detectTask(String(rankFor)))
      return Response.json({
        best: ranked[0]?.id || null,
        candidates: ranked.slice(0, 5).map(m => ({ id: m.id, provider: m.provider, free: m.free })),
      })
    }

    if (!modelId || !provider) {
      return Response.json({ success: false, error: 'Informe modelId e provider' }, { status: 400 })
    }

    return Response.json(await testProviderModel(provider, modelId, { full: full === true }))
  } catch (error) {
    return Response.json({ success: false, error: String((error as Error).message) }, { status: 200 })
  }
}
