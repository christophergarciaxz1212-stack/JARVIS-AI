import { NextRequest } from 'next/server'
import {
  listContacts, getContact, searchContacts, upsertContact,
  listReminders, addReminder, setReminderDone, normalizePhone, displayName, logWa,
} from '@/lib/wa/store'
import { saveConfig } from '@/lib/wa/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })
const CONTACT_KEYS = new Set(['alias', 'name', 'tags', 'notes', 'category', 'starred'])

/** Retém só as chaves conhecidas (nunca espalha o body cru no contato). */
const pickContact = (b: Record<string, unknown>): Record<string, unknown> => {
  const patch: Record<string, unknown> = {}
  for (const k of Object.keys(b)) if (CONTACT_KEYS.has(k)) patch[k] = b[k]
  return patch
}

export async function GET(req: NextRequest) {
  try {
    const q = new URL(req.url).searchParams
    const query = q.get('q') || q.get('search') || ''
    const phone = q.get('phone')
    if (phone) {
      const p = normalizePhone(phone)
      const c = getContact(p)
      return c
        ? Response.json({ contact: c, displayName: displayName(c) })
        : Response.json({ error: 'Não encontrado' }, { status: 404 })
    }
    const contacts = query.trim() ? searchContacts(query) : listContacts()
    return Response.json({ contacts, reminders: listReminders() })
  } catch (e) {
    return fail(e, 500)
  }
}

export async function POST(req: NextRequest) {
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return fail('JSON inválido', 400) }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const action = str(b.action)
  try {
    switch (action) {
      case 'reminder-done': {
        if (typeof b.id !== 'string') return fail('id obrigatório', 400)
        setReminderDone(b.id)
        return Response.json({ ok: true })
      }
      case 'reminder-add': {
        const phone = normalizePhone(str(b.phone))
        const text = str(b.text)
        if (!phone || !text) return fail('phone e text obrigatórios', 400)
        const at = typeof b.at === 'number' ? b.at : undefined
        return Response.json({ ok: true, reminder: addReminder(phone, text, at) })
      }
      case 'urgent-keywords': {
        const list = Array.isArray(b.keywords) ? (b.keywords as unknown[]).map(k => String(k).trim().toLowerCase()).filter(Boolean).slice(0, 40) : []
        saveConfig({ urgentKeywords: list })
        return Response.json({ ok: true, urgentKeywords: list })
      }
      default: {
        // upsert/genérico — aceita {phone|id, alias, name, tags, notes, category, starred} ou patch aninhado
        const phone = normalizePhone(str(b.phone || b.id))
        if (!phone) return fail('phone obrigatório', 400)
        const patch = typeof b.patch === 'object' && b.patch ? pickContact(b.patch as Record<string, unknown>) : pickContact(b)
        const tags = Array.isArray(patch.tags) ? (patch.tags as unknown[]).map(t => String(t).trim()).filter(Boolean).slice(0, 20) : undefined
        if (tags) patch.tags = tags
        const contact = upsertContact(phone, patch)
        logWa('contact-upserted', { phone })
        return Response.json({ ok: true, contact })
      }
    }
  } catch (e) {
    return fail(e, 500)
  }
}
