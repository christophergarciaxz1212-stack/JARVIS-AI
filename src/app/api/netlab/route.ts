import fs from 'fs'
import { NextRequest } from 'next/server'
import { getTopology, listTopologies, savePositions } from '@/lib/netlab/store'
import { validateTopology } from '@/lib/netlab/model'
import { deviceConfigs } from '@/lib/netlab/configs'
import { topologySvg } from '@/lib/netlab/svg'
import { topologyPng } from '@/lib/netlab/png'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (msg: string, status = 400) => Response.json({ error: msg }, { status })
const fileName = (s: string) => s.replace(/[^\w.-]+/g, '_').slice(0, 60) || 'topologia'

export async function GET(req: NextRequest) {
  const q = new URL(req.url).searchParams
  const action = q.get('action') || 'get'
  if (action === 'list') return Response.json({ topologies: await listTopologies() })
  const t = getTopology(q.get('id') || '')
  if (!t) return fail('Topologia não encontrada', 404)
  const download = q.get('download') === '1'
  try {
    switch (action) {
      case 'get':
        return Response.json({ topology: t, issues: validateTopology(t), configs: deviceConfigs(t) })
      case 'svg':
        return new Response(topologySvg(t), {
          headers: {
            'content-type': 'image/svg+xml; charset=utf-8',
            // Model-written text is escaped anyway; the CSP makes sure an SVG can never run script
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
            ...(download ? { 'content-disposition': `attachment; filename="${fileName(t.title)}.svg"` } : {}),
          },
        })
      case 'png': {
        const png = await topologyPng(t)
        return new Response(new Uint8Array(fs.readFileSync(png)), {
          headers: { 'content-type': 'image/png', 'cache-control': 'no-store', ...(download ? { 'content-disposition': `attachment; filename="${fileName(t.title)}.png"` } : {}) },
        })
      }
      case 'configs': {
        const text = deviceConfigs(t).map(c => `########## ${c.label} — ${c.platform} (${c.filename}) ##########\n${c.text}\n`).join('\n')
        return new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'content-disposition': `attachment; filename="${fileName(t.title)}-configs.txt"` } })
      }
      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail((e as Error).message, 500)
  }
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return fail('JSON inválido') }
  try {
    if (b.action === 'positions') {
      const raw = (b.positions && typeof b.positions === 'object' ? b.positions : {}) as Record<string, { x: number; y: number }>
      return Response.json({ topology: savePositions(String(b.id || ''), raw) })
    }
    return fail('Ação inválida', 404)
  } catch (e) {
    return fail((e as Error).message)
  }
}
