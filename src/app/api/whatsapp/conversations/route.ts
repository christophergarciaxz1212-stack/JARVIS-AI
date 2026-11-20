import { NextRequest } from 'next/server'
import {
  listConversations, getConversation, getMessages, markConversationRead, setConversationFlags,
  upsertContact, getContact, normalizePhone, displayName,
} from '@/lib/wa/store'
import { windowExpiresAt } from '@/lib/wa/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

const withMeta = (c: ReturnType<typeof getConversation> extends infer T ? NonNullable<T> : never) => {
  const contact = getContact(c.phone)
  const exp = windowExpiresAt(c.phone)
  const alias = contact?.alias || contact?.name
  return {
    ...c,
    displayName: alias || c.name || `+${c.phone}`,
    starred: contact?.starred || c.starred || false,
    windowExpiresAt: exp,
    insideWindow: !!exp && Date.now() < exp,
  }
}

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams
    const phone = q.get('phone')
    const search = q.get('search')?.trim().toLowerCase()

    if (search) {
      const all = listConversations()
        .filter(c => (c.name || '').toLowerCase().includes(search) || c.phone.includes(search.replace(/\D/g, '')))
        .map(withMeta)
      return Response.json({ conversations: all })
    }

    if (phone) {
      const p = normalizePhone(phone)
      const conv = getConversation(p)
      const contact = getContact(p)
      const exp = windowExpiresAt(p)
      markConversationRead(p)
      return Response.json({
        phone: p,
        name: (contact?.alias || contact?.name || conv?.name) || `+${p}`,
        contact,
        conversation: conv ? withMeta(conv) : conv,
        windowExpiresAt: exp,
        insideWindow: !!exp && Date.now() < exp,
        messages: getMessages(p),
      })
    }

    return Response.json({ conversations: listConversations().map(withMeta) })
  } catch (e) {
    return fail(e, 500)
  }
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return fail('JSON inválido', 400) }
  const str = (v: unknown) => (typeof v === 'string' ? v : '')
  try {
    const phone = normalizePhone(str(b.phone || b.to))
    switch (str(b.action)) {
      case 'read':
      case 'mark-read': {
        if (!phone) return fail('phone obrigatório', 400)
        markConversationRead(phone)
        return Response.json({ ok: true })
      }
      case 'important': {
        if (!phone) return fail('phone obrigatório', 400)
        setConversationFlags(phone, { important: !!b.value })
        return Response.json({ ok: true })
      }
      case 'star': {
        if (!phone) return fail('phone obrigatório', 400)
        const contact = upsertContact(phone, { starred: !!b.value })
        setConversationFlags(phone, { starred: contact.starred })
        return Response.json({ ok: true, starred: contact.starred })
      }
      case 'flags': {
        if (!phone) return fail('phone obrigatório', 400)
        setConversationFlags(phone, (b.patch as Record<string, boolean>) || {})
        return Response.json({ ok: true })
      }
      case 'contact': {
        if (!phone) return fail('phone obrigatório', 400)
        const c = upsertContact(phone, (b.patch as Record<string, unknown>) || {})
        return Response.json({ ok: true, contact: c })
      }
      case 'get-contact': {
        if (!phone) return fail('phone obrigatório', 400)
        return Response.json({ contact: getContact(phone) })
      }
      case 'rename': {
        if (!phone) return fail('phone obrigatório', 400)
        const patch = typeof b.patch === 'object' && b.patch ? b.patch as Record<string, unknown> : {}
        const alias = str(b.alias || b.displayName || patch.alias || patch.name).trim().slice(0, 80)
        upsertContact(phone, { alias: alias || undefined })
        return Response.json({ ok: true })
      }
      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e, 500)
  }
}
