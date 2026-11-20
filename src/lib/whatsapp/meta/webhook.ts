import type { WaMessage, WaMessageType, WaMedia, WaLocation } from './types'

export type ParsedWebhook = {
  messages: WaMessage[]
  statuses: Array<{ id: string; status: string; timestamp: number; recipientId?: string; errors?: any[] }>
  contacts: Array<{ waId: string; name?: string }>
  rawEntries: any[]
}

function toMs(ts?: string | number): number {
  if (ts == null) return Date.now()
  const n = typeof ts === 'string' ? Number(ts) : ts
  if (!Number.isFinite(n)) return Date.now()
  // Meta sends seconds
  return n < 1e12 ? n * 1000 : n
}

function mapType(t?: string): WaMessageType {
  switch (t) {
    case 'text': return 'text'
    case 'image': return 'image'
    case 'audio': return 'audio'
    case 'video': return 'video'
    case 'document': return 'document'
    case 'sticker': return 'sticker'
    case 'location': return 'location'
    case 'contacts': return 'contacts'
    case 'interactive': return 'interactive'
    case 'reaction': return 'reaction'
    case 'button': return 'text'
    case 'template': return 'template'
    default: return 'unknown'
  }
}

export function parseWebhookPayload(body: any): ParsedWebhook {
  const out: ParsedWebhook = { messages: [], statuses: [], contacts: [], rawEntries: [] }
  const entries = Array.isArray(body?.entry) ? body.entry : []
  for (const entry of entries) {
    out.rawEntries.push(entry)
    const changes = Array.isArray(entry?.changes) ? entry.changes : []
    for (const change of changes) {
      const value = change?.value || {}
      // contacts
      const contacts = Array.isArray(value.contacts) ? value.contacts : []
      for (const c of contacts) {
        out.contacts.push({ waId: String(c.wa_id || c.profile?.phone || ''), name: c.profile?.name })
      }
      // messages
      const msgs = Array.isArray(value.messages) ? value.messages : []
      for (const m of msgs) {
        const from = String(m.from || '')
        const to = String(value.metadata?.phone_number_id || value.metadata?.display_phone_number || '')
        const conversationId = from // inbound: other party is sender
        const type = mapType(m.type)
        const msg: WaMessage = {
          id: String(m.id),
          conversationId,
          direction: 'inbound',
          from,
          to,
          type,
          timestamp: toMs(m.timestamp),
          status: 'delivered', // inbound delivered to us
          contactName: contacts.find((c: any) => c.wa_id === from)?.profile?.name,
          raw: m,
        }
        // text
        if (type === 'text') msg.text = m.text?.body
        if (type === 'image') {
          msg.media = { id: m.image?.id, mimeType: m.image?.mime_type, caption: m.image?.caption, sha256: m.image?.sha256 }
          msg.text = m.image?.caption
        }
        if (type === 'audio') msg.media = { id: m.audio?.id, mimeType: m.audio?.mime_type, sha256: m.audio?.sha256 }
        if (type === 'video') {
          msg.media = { id: m.video?.id, mimeType: m.video?.mime_type, caption: m.video?.caption, sha256: m.video?.sha256 }
          msg.text = m.video?.caption
        }
        if (type === 'document') {
          msg.media = { id: m.document?.id, mimeType: m.document?.mime_type, filename: m.document?.filename, caption: m.document?.caption, sha256: m.document?.sha256 }
          msg.text = m.document?.caption
        }
        if (type === 'sticker') msg.media = { id: m.sticker?.id, mimeType: m.sticker?.mime_type, sha256: m.sticker?.sha256 }
        if (type === 'location') {
          msg.location = {
            latitude: Number(m.location?.latitude),
            longitude: Number(m.location?.longitude),
            name: m.location?.name,
            address: m.location?.address,
          }
        }
        if (type === 'reaction') {
          msg.text = m.reaction?.emoji
          msg.quotedMessageId = m.reaction?.message_id
        }
        if (m.context?.id) msg.quotedMessageId = m.context.id
        out.messages.push(msg)
      }
      // statuses
      const statuses = Array.isArray(value.statuses) ? value.statuses : []
      for (const st of statuses) {
        out.statuses.push({
          id: String(st.id),
          status: String(st.status),
          timestamp: toMs(st.timestamp),
          recipientId: st.recipient_id,
          errors: st.errors,
        })
      }
    }
  }
  return out
}