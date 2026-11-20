import { healthCheck } from '@/lib/wa/meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Diagnóstico real da conexão (chama a Meta de verdade quando há credenciais). */
export async function GET() {
  try {
    const health = await healthCheck()
    return Response.json({ health })
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
