import { NextRequest } from 'next/server'
import { hardwareInfo, installedLocalModels, listLocalPulls, LOCAL_MODELS, startLocalPull } from '@/lib/ai/local'

/** Catálogo local curado + o que já está instalado no Ollama. */
export async function GET() {
  const hardware = hardwareInfo()
  let installed: Awaited<ReturnType<typeof installedLocalModels>> = []
  let ollama = true
  try {
    installed = await installedLocalModels()
  } catch {
    ollama = false
  }
  const pulls = listLocalPulls()
  const installedIds = new Set(installed.map(m => m.id))

  return Response.json({
    ollama,
    hardware,
    installed,
    pulls,
    models: LOCAL_MODELS.map(spec => {
      const pull = pulls.find(p => p.model === spec.id)
      return {
        ...spec,
        installed: installedIds.has(spec.id),
        fitsGpu: hardware.vramGB === null || spec.recommendedVramGB <= hardware.vramGB,
        pulling: pull?.status === 'running' ? pull : undefined,
        lastPull: pull,
      }
    }),
  })
}

/** Baixa um modelo do catálogo local via Ollama (streaming acompanhado por GET). */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const model = String(body.model || '')
    if (!model) return Response.json({ error: 'Informe o modelo' }, { status: 400 })
    return Response.json({ pull: startLocalPull(model) })
  } catch (error) {
    return Response.json({ error: (error as Error).message }, { status: 400 })
  }
}
