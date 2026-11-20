import { NextRequest } from 'next/server'
import { disconnect } from '@/lib/whatsapp/meta/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  let erase = false
  try { const b = await req.json(); erase = b?.erase === true } catch {}
  return Response.json(await disconnect(erase))
}