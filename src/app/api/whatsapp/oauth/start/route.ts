import { NextRequest } from 'next/server'
import { oauthStartUrl } from '@/lib/whatsapp/meta/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const url = oauthStartUrl()
    return Response.json({ url })
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e) }, { status: 400 })
  }
}