import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

let tmp: string
let oldDataDir: string | undefined

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-wa-'))
  oldDataDir = process.env.JARVIS_DATA_DIR
  process.env.JARVIS_DATA_DIR = tmp
})
afterEach(() => {
  if (oldDataDir === undefined) delete process.env.JARVIS_DATA_DIR
  else process.env.JARVIS_DATA_DIR = oldDataDir
  fs.rmSync(tmp, { recursive: true, force: true })
})

const loadModules = () => Promise.all([import('@/lib/wa/meta'), import('@/lib/wa/store'), import('@/lib/wa/events')])

describe('assinatura X-Hub-Signature-256 (verificação real)', () => {
  it('aceita assinatura correta e rejeita adulterada/ausente', async () => {
    const { verifySignature } = await loadModules().then(m => m[0])
    const secret = 'app-secret-de-teste'
    const body = '{"object":"whatsapp_business_account","entry":[]}'
    const mac = crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex')
    expect(verifySignature(body, `sha256=${mac}`, secret)).toBe(true)
    expect(verifySignature(body, `sha256=${mac.replace(/.$/, '0')}`, secret)).toBe(false)
    expect(verifySignature(body, 'sha1=abc', secret)).toBe(false)
    expect(verifySignature(body, null, secret)).toBe(false)
    expect(verifySignature(body + 'tamper', `sha256=${mac}`, secret)).toBe(false)
  })
})

describe('parseWebhookEvent (payload oficial da Meta)', () => {
  const sample = (overrides: Record<string, unknown> = {}) => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA123',
      changes: [{
        field: 'messages',
        value: {
          messaging_product: 'whatsapp',
          contacts: [{ wa_id: '5511987654321', profile: { name: 'Maria Silva' } }],
          messages: [{
            from: '5511987654321', id: 'wamid.INBOUND_1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text',
            text: { body: 'Olá, tudo bem?' }, ...overrides,
          }],
        },
      }],
    }],
  })

  it('extrai mensagem de texto com remetente e nome do perfil', async () => {
    const { parseWebhookEvent } = await loadModules().then(m => m[0])
    const evt = parseWebhookEvent(sample())
    expect(evt.inbound).toHaveLength(1)
    expect(evt.inbound[0].phone).toBe('5511987654321')
    expect(evt.inbound[0].name).toBe('Maria Silva')
    expect(evt.inbound[0].text).toBe('Olá, tudo bem?')
    expect(evt.inbound[0].wamid).toBe('wamid.INBOUND_1')
  })

  it('extrai mídia (image com caption e id)', async () => {
    const { parseWebhookEvent } = await loadModules().then(m => m[0])
    const img = sample({ type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'veja isso' } })
    delete (img as { messages?: unknown }).messages
    ;(img as { entry: Array<{ changes: Array<{ value: { messages: Array<Record<string, unknown>> } }> }> })
      .entry[0].changes[0].value.messages = [{
        from: '5511987654321', id: 'wamid.IMG_1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'image',
        image: { id: 'media-1', mime_type: 'image/jpeg', caption: 'veja isso' },
      }]
    const evt = parseWebhookEvent(img)
    expect(evt.inbound[0].type).toBe('image')
    expect(evt.inbound[0].text).toBe('veja isso')
    expect(evt.inbound[0].mediaId).toBe('media-1')
  })

  it('extrai status de entrega e ignora objetos não-Meta', async () => {
    const { parseWebhookEvent } = await loadModules().then(m => m[0])
    expect(parseWebhookEvent({ object: 'page', entry: [] }).statuses).toEqual([])
    const evt = parseWebhookEvent({
      object: 'whatsapp_business_account',
      entry: [{ id: 'W', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.OUT_1', recipient_id: '5511987654321', status: 'read', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }],
    })
    expect(evt.statuses).toHaveLength(1)
    expect(evt.statuses[0].status).toBe('read')
  })
})

describe('pipeline de webhook (dedup, persistência, janela de 24h)', () => {
  const inboundPayload = () => ({
    object: 'whatsapp_business_account',
    entry: [{
      id: 'WABA', changes: [{
        field: 'messages',
        value: {
          contacts: [{ wa_id: '5511912345678', profile: { name: 'Carlos' } }],
          messages: [{ from: '5511912345678', id: 'wamid.DUP_TEST', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'prazo amanhã às 14h' } }],
        },
      }],
    }],
  })

  it('persiste a mensagem, cria a conversa e deduplica reenvio', async () => {
    const [, store, events] = await loadModules()
    const first = await events.processWebhookPayload((await import('@/lib/wa/meta')).parseWebhookEvent(inboundPayload()))
    expect(first.inbound).toBe(1)
    expect(first.deduped).toBe(0)
    const conv = store.getConversation('5511912345678')
    expect(conv).toBeTruthy()
    expect(conv!.unread).toBe(1)
    expect(store.getMessages('5511912345678')).toHaveLength(1)
    expect(store.isProcessedWamid('wamid.DUP_TEST')).toBe(true)

    const second = await events.processWebhookPayload((await import('@/lib/wa/meta')).parseWebhookEvent(inboundPayload()))
    expect(second.inbound).toBe(0)
    expect(second.deduped).toBe(1)
    expect(store.getMessages('5511912345678')).toHaveLength(1)
    expect(store.getConversation('5511912345678')!.unread).toBe(1)
  })

  it('status update atualiza a mensagem de saída', async () => {
    const [meta, store] = await loadModules()
    store.appendMessage({ id: 'wamid.OUT_2', wamid: 'wamid.OUT_2', phone: '5511912345678', direction: 'out', type: 'text', text: 'oi', at: Date.now(), status: 'sent' })
    store.appendMessage({ id: 'wamid.OUT_2', wamid: 'wamid.OUT_2', phone: '5511912345678', direction: 'out', type: 'text', text: 'oi', at: Date.now(), status: 'sent' })
    expect(store.getMessages('5511912345678')).toHaveLength(1) // dedup por wamid
    expect(store.getMessages('5511912345678')[0].status).toBe('sent')
    const evt = meta.parseWebhookEvent({
      object: 'whatsapp_business_account',
      entry: [{ id: 'W', changes: [{ field: 'messages', value: { statuses: [{ id: 'wamid.OUT_2', recipient_id: '5511912345678', status: 'delivered', timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }],
    })
    const ok = store.updateMessageStatus(evt.statuses[0].wamid, evt.statuses[0].status)
    expect(ok).toBe(true)
    expect(store.getMessages('5511912345678')[0].status).toBe('delivered')
  })

  it('janela de 24h segue o lastInboundAt', async () => {
    const [, store] = await loadModules()
    expect(store.isInsideWindow('5511900000001')).toBe(false)
    store.upsertConversation('5511900000001', { lastText: 'x', lastAt: Date.now() - 25 * 3600_000, lastInboundAt: Date.now() - 25 * 3600_000, unread: 0, important: false, starred: false })
    expect(store.isInsideWindow('5511900000001')).toBe(false)
    store.upsertConversation('5511900000002', { lastText: 'x', lastAt: Date.now(), lastInboundAt: Date.now(), unread: 1, important: false, starred: false })
    expect(store.isInsideWindow('5511900000002')).toBe(true)
  })

  it('automação de urgência marca importante e compromisso cria lembrete', async () => {
    const [, store, events] = await loadModules()
    const payload = {
      object: 'whatsapp_business_account',
      entry: [{
        id: 'WABA', changes: [{
          field: 'messages',
          value: {
            contacts: [{ wa_id: '5511922223333', profile: { name: 'Ana' } }],
            messages: [{ from: '5511922223333', id: 'wamid.SLA_1', timestamp: String(Math.floor(Date.now() / 1000)), type: 'text', text: { body: 'É urgente: cobrança vence amanhã' } }],
          },
        }],
      }],
    }
    const res = await events.processWebhookPayload((await import('@/lib/wa/meta')).parseWebhookEvent(payload))
    expect(res.automationsFired).toBeGreaterThanOrEqual(2) // urgencia + compromisso
    const reminders = store.listReminders()
    expect(reminders.some(r => r.phone === '5511922223333')).toBe(true)
  })
})

describe('comandos em linguagem natural do chat', () => {
  it('reconhece intenções e ignora frases comuns', async () => {
    const { matchWaCommand } = await import('@/lib/wa/commands')
    expect(matchWaCommand('JARVIS, responda o João dizendo que vou chegar às 15h')?.kind).toBe('send')
    expect(matchWaCommand('envie para Maria perguntando se está tudo certo')?.kind).toBe('send')
    expect(matchWaCommand('confirmar envio')?.kind).toBe('confirm')
    expect(matchWaCommand('cancelar envio')?.kind).toBe('cancel')
    expect(matchWaCommand('quem está aguardando resposta')?.kind).toBe('waiting')
    expect(matchWaCommand('procure a última mensagem de Pedro')?.kind).toBe('last')
    expect(matchWaCommand('resuma a conversa com Maria')?.kind).toBe('summarize')
    expect(matchWaCommand('avise meus clientes que a loja abriu')?.kind).toBe('broadcast')
    expect(matchWaCommand('crie um vídeo sobre café')).toBeNull()
    expect(matchWaCommand('qual é a previsão do tempo?')).toBeNull()
  })

  it('nome após o verbo não inclui a preposição "o/a"', async () => {
    const { matchWaCommand } = await import('@/lib/wa/commands')
    const m = matchWaCommand('responda o João dizendo que vou chegar às 15h')
    expect(m?.kind).toBe('send')
    expect(m?.name).toBe('João')
    expect(m?.text).toBe('vou chegar às 15h')
  })

  it('envia a mensagem extraída após CONFIRMAR ENVIO simulado (send injetado)', async () => {
    const { matchWaCommand, waCommandRunner, setWaSendForTests } = await import('@/lib/wa/commands')
    const store = await import('@/lib/wa/store')
    store.upsertContact('5511955556666', { alias: 'Maria' })
    store.upsertConversation('5511955556666', { lastText: 'oi', lastAt: Date.now(), lastInboundAt: Date.now(), unread: 0, important: false, starred: false })

    const sent: Array<{ to: string; text: string }> = []
    setWaSendForTests(async (to: string, text: string) => { sent.push({ to, text }); return { ok: true, wamid: 'wamid.TEST' } })
    try {
      const m = matchWaCommand('responda para Maria dizendo que está tudo certo')!
      expect(m.kind).toBe('send')
      const prep = waCommandRunner('responda para Maria dizendo que está tudo certo')!
      const prepMsg = await prep()
      expect(prepMsg).toMatch(/CONFIRMAR ENVIO/)
      expect(store.getPending()?.to).toBe('5511955556666')
      const confirm = waCommandRunner('confirmar envio')!
      const done = await confirm()
      expect(done).toMatch(/Mensagem enviada/)
      expect(sent).toEqual([{ to: '5511955556666', text: 'está tudo certo' }])
      expect(store.getPending()).toBeNull()
    } finally {
      setWaSendForTests(undefined)
    }
  })
})
