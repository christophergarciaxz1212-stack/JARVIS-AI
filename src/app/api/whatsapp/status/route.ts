import { NextRequest } from 'next/server'
import { getConfig, saveConfig, configStatus, getVerifyToken, rotateVerifyToken } from '@/lib/wa/config'
import { healthCheck } from '@/lib/wa/meta'
import { listConversations, listContacts, listReminders } from '@/lib/wa/store'
import { processWebhookPayload } from '@/lib/wa/events'
import { parseWebhookEvent } from '@/lib/wa/meta'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const cfg = configStatus()
  return Response.json({
    config: cfg,
    verifyToken: getVerifyToken(),
    counts: {
      conversations: listConversations().length,
      contacts: listContacts().length,
      reminders: listReminders().length,
    },
  })
}

export async function POST(req: NextRequest) {
  let b: any
  try { b = await req.json() } catch { return Response.json({ error: 'JSON inválido' }, { status: 400 }) }
  try {
    if (b.action === 'save-config') {
      const patch: any = {}
      if (b.phoneNumberId !== undefined) patch.phoneNumberId = b.phoneNumberId
      if (b.wabaId !== undefined) patch.wabaId = b.wabaId
      if (b.appId !== undefined) patch.appId = b.appId
      if (b.configId !== undefined) patch.configId = b.configId
      if (b.displayName !== undefined) patch.displayName = b.displayName
      if (b.requireConfirmSend !== undefined) patch.requireConfirmSend = !!b.requireConfirmSend
      if (b.notify) patch.notify = b.notify
      if (b.businessHours) patch.businessHours = b.businessHours
      if (b.autoReply) patch.autoReply = b.autoReply
      if (b.urgentKeywords) patch.urgentKeywords = b.urgentKeywords
      if (b.automations) patch.automations = b.automations
      const cfg = saveConfig(patch)
      return Response.json({ ok: true, config: configStatus(), saved: cfg })
    }
    if (b.action === 'diagnose') {
      return Response.json(await healthCheck())
    }
    if (b.action === 'rotate-verify-token') {
      const t = rotateVerifyToken()
      return Response.json({ ok: true, verifyToken: t })
    }
    if (b.action === 'simulate-webhook') {
      const fake = {
        object: 'whatsapp_business_account',
        entry: [{
          id: 'test-waba',
          changes: [{
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5511999999999', phone_number_id: '123' },
              contacts: [{ profile: { name: 'Contato Teste' }, wa_id: '5511888888888' }],
              messages: [{
                from: '5511888888888',
                id: `wamid.test.${Date.now()}`,
                timestamp: String(Math.floor(Date.now() / 1000)),
                text: { body: 'Mensagem de teste do JARVIS' },
                type: 'text',
              }],
            },
            field: 'messages',
          }],
        }],
      }
      const evt = parseWebhookEvent(fake)
      const r = await processWebhookPayload(evt)
      return Response.json({ ok: true, ...r })
    }
    return Response.json({ error: 'Ação inválida' }, { status: 404 })
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e) }, { status: 400 })
  }
}