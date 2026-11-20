import { isSeen, markSeen, logEvent } from './store'
import { parseWebhookPayload } from './webhook'
import { upsertContact, upsertConversation, appendMessage, updateMessageStatus, addNotification, listAutomations } from './store'
import { broadcast } from './realtime'

let processing = false
const pending: any[] = []

export function enqueueWebhook(body: any) {
  pending.push(body)
  void processQueue()
}

async function processQueue() {
  if (processing) return
  processing = true
  try {
    while (pending.length) {
      const body = pending.shift()
      await handlePayload(body).catch(e => {
        console.error('[wa-meta] process error', e)
      })
    }
  } finally {
    processing = false
  }
}

async function handlePayload(body: any) {
  const eventId = body?.entry?.[0]?.id || `evt-${Date.now()}-${Math.random().toString(36).slice(2)}`
  // parse
  const parsed = parseWebhookPayload(body)
  // dedup messages
  for (const c of parsed.contacts) {
    if (!c.waId) continue
    upsertContact({ waId: c.waId, name: c.name, phone: c.waId })
  }
  for (const m of parsed.messages) {
    if (isSeen(m.id)) {
      logEvent({ id: m.id, type: 'message_duplicate', payload: m, processed: true })
      continue
    }
    markSeen(m.id)
    // contact upsert
    const contact = upsertContact({ waId: m.from, name: m.contactName, phone: m.from })
    // conversation
    const conv = upsertConversation({
      id: m.conversationId,
      contactId: contact.id,
      name: contact.name,
      phone: contact.phone || m.from,
      lastMessageAt: m.timestamp,
      lastMessagePreview: (m.text || m.media?.caption || `[${m.type}]`).slice(0, 120),
      lastDirection: 'inbound',
      unread: (getUnread(m.conversationId) + 1),
    })
    appendMessage(m)
    // notification
    const notif = {
      id: `notif-${m.id}`,
      messageId: m.id,
      conversationId: m.conversationId,
      contactName: contact.name || m.contactName,
      phone: m.from,
      preview: (m.text || m.media?.caption || `[${m.type}]`).slice(0, 160),
      timestamp: m.timestamp,
      read: false,
    }
    addNotification(notif)
    broadcast('message', { message: m, contact, conversation: conv, notification: notif })
    // automations
    runAutomations(m, contact, conv)
    logEvent({ id: m.id, type: 'message', payload: { id: m.id, from: m.from }, processed: true })
  }
  for (const st of parsed.statuses) {
    if (st.status === 'sent' || st.status === 'delivered' || st.status === 'read' || st.status === 'failed') {
      const s = st.status === 'sent' ? 'sent' : st.status === 'delivered' ? 'delivered' : st.status === 'read' ? 'read' : 'failed'
      updateMessageStatus(st.id, s as any)
      broadcast('status', { messageId: st.id, status: s, timestamp: st.timestamp, errors: st.errors })
    }
  }
  // update config lastWebhookAt
  const { writeConfig } = await import('./store')
  writeConfig({ lastWebhookAt: Date.now(), webhookVerified: true })
}

function getUnread(convId: string): number {
  const { getConversation } = require('./store')
  return getConversation(convId)?.unread || 0
}

function runAutomations(m: any, contact: any, conv: any) {
  const autos = listAutomations()
  for (const a of autos) {
    if (!a.enabled) continue
    const t = a.trigger
    let match = false
    if (t.type === 'any') match = true
    else if (t.type === 'keyword' && t.keyword && (m.text || '').toLowerCase().includes(t.keyword.toLowerCase())) match = true
    else if (t.type === 'contact' && t.contactPhone && (m.from || '').includes(t.contactPhone.replace(/\D/g, ''))) match = true
    else if (t.type === 'question' && (m.text || '').includes('?')) match = true
    else if (t.type === 'document' && m.type === 'document') match = true
    else if (t.type === 'outside_hours') {
      const h = new Date(m.timestamp).getHours()
      // simple: if start>end means overnight
      match = true // placeholder; refine if needed
    }
    if (!match) continue
    const action = a.action
    if (action.type === 'notify') {
      // already notified
    } else if (action.type === 'classify' && action.category) {
      const { upsertConversation, upsertContact } = require('./store')
      upsertConversation({ id: conv.id, category: action.category })
      upsertContact({ waId: contact.waId, category: action.category })
    } else if (action.type === 'auto_reply' && action.replyText) {
      // execute auto reply (best-effort) — only if connected
      void (async () => {
        try {
          const { readConfig, readSecrets } = await import('./store')
          const cfg = readConfig()
          if (!cfg.connected || !cfg.phoneNumberId) return
          const { sendText } = await import('./client')
          const res = await sendText(cfg.phoneNumberId, m.from, action.replyText!)
          const { appendMessage } = await import('./store')
          appendMessage({
            id: res.messages?.[0]?.id || `auto-${Date.now()}`,
            conversationId: m.conversationId,
            direction: 'outbound',
            from: cfg.displayPhoneNumber || '',
            to: m.from,
            type: 'text',
            text: action.replyText,
            timestamp: Date.now(),
            status: 'sent',
          })
          broadcast('message', { autoReply: true })
        } catch (e) { console.error('[wa-meta] auto_reply failed', e) }
      })()
    } else if (action.type === 'create_reminder') {
      // broadcast a suggested reminder
      broadcast('reminder', { from: m.from, text: m.text, conversationId: m.conversationId })
    } else if (action.type === 'organize_file') {
      broadcast('file', { media: m.media, conversationId: m.conversationId })
    } else if (action.type === 'suggest_reply') {
      broadcast('suggest_reply', { conversationId: m.conversationId, messageId: m.id })
    }
  }
}