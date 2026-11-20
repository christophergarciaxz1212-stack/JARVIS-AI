import { NextRequest } from 'next/server'
import { configStatus, getVerifyToken, rotateVerifyToken, saveConfig, getConfig } from '@/lib/wa/config'
import { saveKey } from '@/lib/keys'
import { listConversations, listContacts } from '@/lib/wa/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

/** Visão mascarada — nunca devolve segredos. */
export async function GET() {
  const contacts = listContacts()
  const conversations = listConversations()
  return Response.json({
    ...configStatus(),
    totals: { conversations: conversations.length, contacts: contacts.length, unread: conversations.reduce((n, c) => n + (c.unread || 0), 0) },
  })
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return fail('JSON inválido', 400) }
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

  try {
    switch (String(body.action || 'save')) {
      case 'save': {
        const patch: Record<string, unknown> = {}
        if ('phoneNumberId' in body) patch.phoneNumberId = str(body.phoneNumberId)
        if ('wabaId' in body) patch.wabaId = str(body.wabaId)
        if ('appId' in body) patch.appId = str(body.appId)
        if ('configId' in body) patch.configId = str(body.configId)
        if ('displayName' in body) patch.displayName = str(body.displayName).slice(0, 80)
        if ('requireConfirmSend' in body) patch.requireConfirmSend = !!body.requireConfirmSend
        if (body.notify && typeof body.notify === 'object') patch.notify = body.notify
        if (body.businessHours && typeof body.businessHours === 'object') patch.businessHours = body.businessHours
        if (body.autoReply && typeof body.autoReply === 'object') patch.autoReply = body.autoReply
        if (Array.isArray(body.urgentKeywords)) patch.urgentKeywords = (body.urgentKeywords as unknown[]).map(x => String(x).trim()).filter(Boolean).slice(0, 40)
        if (body.automations && typeof body.automations === 'object') patch.automations = body.automations
        const saved = saveConfig(patch)
        return Response.json({ ok: true, config: configStatus(), displayName: saved.displayName })
      }
      case 'save-secrets': {
        // Segredos vão para keys.json via lib/keys (nunca no config.json)
        const token = str(body.accessToken)
        const secret = str(body.appSecret)
        if (token) {
          if (!/^EAA[A-Za-z0-9]/.test(token)) return fail('Esse token não parece um token de acesso da Meta (comece com "EAA…").', 400)
          saveKey('WA_ACCESS_TOKEN', token)
        }
        if (secret) saveKey('WA_APP_SECRET', secret)
        return Response.json({ ok: true, config: configStatus() })
      }
      case 'clear-secrets': {
        saveKey('WA_ACCESS_TOKEN', '')
        saveKey('WA_APP_SECRET', '')
        return Response.json({ ok: true, config: configStatus() })
      }
      case 'reveal-verify-token': {
        // Só chamado quando o usuário clica explicitamente em "copiar" no assistente
        return Response.json({ ok: true, verifyToken: getVerifyToken() })
      }
      case 'rotate-verify-token': {
        rotateVerifyToken()
        return Response.json({ ok: true, config: configStatus() })
      }
      default:
        return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e, 500)
  }
}
