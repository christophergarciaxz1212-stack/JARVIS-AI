/**
 * JARVIS — Comandos de WhatsApp em linguagem natural (usados pelo chat).
 * Segue o mesmo padrão de media/commands.ts: o chat reconhece a intenção e
 * executa via runner. NUNCA envia sem a confirmação configurada pelo usuário
 * (padrão: pedir confirmação — o envio só acontece depois de "CONFIRMAR ENVIO").
 */
import {
  listConversations, listContacts, resolveContactByName, normalizePhone, getPending, setPending, clearPending,
  displayName, type WaContact, type WaPendingAction,
} from './store'
import { sendTextMessage } from './meta'
import { isInsideWindow } from './store'
import { getConfig, saveConfig } from './config'
import { logWa, getMessages } from './store'
import { summarize, buildTranscript } from './ai'

const stripName = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase()

export interface WaMatch {
  kind: 'send' | 'confirm' | 'cancel' | 'waiting' | 'last' | 'summarize' | 'broadcast'
  name?: string
  text?: string
}

export function matchWaCommand(raw: string): WaMatch | null {
  const s = String(raw || '').trim()
  if (!s || s.length > 500) return null

  // CONFIRMAR ENVIO / cancelar envio
  if (/^confirmar\s+(?:o\s+|esse\s+|este\s+)?envio\b/i.test(s)) return { kind: 'confirm' }
  if (/^cancelar\s+(?:o\s+|esse\s+|este\s+)?envio\b/i.test(s)) return { kind: 'cancel' }

  // Quem está aguardando resposta
  if (/^(?:quem\s+(?:est[aá]\s+)?aguarda(?:ndo)?\s+resposta|aguardando\s+resposta(?:s)?|quem\s+est[aá]\s+esperando\s+(?:minha\s+)?resposta)/i.test(s)) return { kind: 'waiting' }

  // Última mensagem de X
  let m = /^(?:procure\s+)?(?:a\s+)?[úu]ltima\s+mensagem\s+d[eoa]?\s+([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' ]{0,38})/i.exec(s)
  if (m) return { kind: 'last', name: m[1].trim() }
  m = /^o\s+que\s+(?:o\s+|a\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' ]{0,38})\s+me\s+disse/i.exec(s)
  if (m) return { kind: 'last', name: m[1].trim() }

  // Resumir conversa com X
  m = /^resuma\s+(?:a\s+conversa\s+(?:com\s+)?|as\s+mensagens\s+(?:com\s+)?|nosso\s+papo\s+(?:com\s+)?)(?:o\s+|a\s+)?([A-Za-zÀ-ÖØ-öø-ÿ][A-Za-zÀ-ÖØ-öø-ÿ' ]{0,38})/i.exec(s)
  if (m) return { kind: 'summarize', name: m[1].trim() }

  // Recusar broadcast explícito (Meta não permite envio em massa pessoal)
  if (/^(?:avise|mande|envie)\s+(?:todos|meus\s+clientes|meus\s+contatos|todo\s+mundo|o\s+grupo)/i.test(s)) return { kind: 'broadcast' }

  // Envio: "responda o João dizendo que vou chegar às 15h" ou "responda para 5511987654321: tudo certo"
  const sendRe = /^(?:jarvis[\s,:]*)?(?:por\s+favor[\s,]*)?(?:responda|mande|envie|fale\s+com|avise)\s+(?:(?:uma\s+)?mensagem\s+)?(?:para\s+)?(?:(?:o|a|pro|pra|para)\s+)?([A-Za-zÀ-ÖØ-öø-ÿ+][A-Za-zÀ-ÖØ-öø-ÿ' +\d()\-]{0,38}?)\s+(?:dizendo(?:\s+que)?|perguntando(?:\s+se)?|avisando(?:\s+(?:que|de))?|falando(?:\s+que)?|que|se|:)\s*([\s\S]+)$/i
  m = sendRe.exec(s)
  if (m) return { kind: 'send', name: m[1].trim(), text: m[2].replace(/\s+/g, ' ').trim() }

  return null
}

export interface WaResolution { phone?: string; name?: string; source?: 'contact' | 'conversation'; candidates: Array<{ label: string; phone: string }> }

export function resolveWhatsApp(name: string): WaResolution {
  const q = stripName(name)
  // Número cru: 5511987654321 ou +55 11 98765-4321
  const digits = normalizePhone(name)
  if (digits.length >= 10) {
    const conv = listConversations().find(c => c.phone === digits)
    const c = listContacts().find(x => x.phone === digits)
    if (c) return { phone: c.phone, name: displayName(c), source: 'contact', candidates: [] }
    if (conv) return { phone: conv.phone, name: conv.name || `+${conv.phone}`, source: 'conversation', candidates: [] }
    return { phone: digits, name: `+${digits}`, source: 'contact', candidates: [] }
  }
  const contacts = listContacts()
  const byAlias = contacts.filter(c => (c.alias || '').toLowerCase().includes(q))
  const byName = contacts.filter(c => (c.name || '').toLowerCase().includes(q))
  const contactMatch = [...byAlias, ...byName.filter(c => !byAlias.includes(c))]
  if (contactMatch.length === 1) {
    const c = contactMatch[0]
    return { phone: c.phone, name: displayName(c), source: 'contact', candidates: [] }
  }
  if (contactMatch.length > 1) {
    return { candidates: contactMatch.map(c => ({ label: displayName(c), phone: c.phone })) }
  }
  // Conversas (nome do perfil do webhook)
  const convs = listConversations().filter(c => (c.name || '').toLowerCase().includes(q))
  if (convs.length === 1) return { phone: convs[0].phone, name: convs[0].name || `+${convs[0].phone}`, source: 'conversation', candidates: [] }
  if (convs.length > 1) return { candidates: convs.map(c => ({ label: c.name || `+${c.phone}`, phone: c.phone })) }
  // Busca por apelido exato via helper (prefixo/parcial) já tentada; cai no vazio
  const { candidates } = resolveContactByName(name)
  return { candidates: candidates.map((c: WaContact) => ({ label: displayName(c), phone: c.phone })) }
}

const PENDING_TTL_MS = 10 * 60_000

function pendingFresh(): WaPendingAction | null {
  const p = getPending()
  if (!p) return null
  if (Date.now() - p.createdAt > PENDING_TTL_MS) { clearPending(); return null }
  return p
}

/** Deps injetáveis para testes (nunca toca na rede em testes). */
let sendFn: typeof sendTextMessage = sendTextMessage
export function setWaSendForTests(fn: typeof sendTextMessage | undefined) {
  sendFn = fn || sendTextMessage
}

async function doSend(to: string, toName: string, text: string, via: 'chat' | 'confirm'): Promise<string> {
  const cfg = getConfig()
  if (!isInsideWindow(to)) {
    return `⚠️ **Não enviei**: a janela de 24h com ${toName} fechou (a Meta só aceita template aprovado fora dela). Abra o Centro do WhatsApp → envio por template aprovado.`
  }
  const r = await sendFn(to, text)
  if (!r.ok) {
    logWa('send-error', { to, error: r.error, code: r.code, via })
    return `❌ **Não consegui enviar** para ${toName}: ${r.error}`
  }
  saveConfig({ stats: { ...cfg.stats, sent: cfg.stats.sent + 1, lastSendAt: Date.now() } })
  logWa('send-ok', { to, wamid: r.wamid, via })
  return `✅ **Mensagem enviada para ${toName}** pela API oficial do WhatsApp (id da Meta: ${r.wamid}).`
}

function listWaiting(): string {
  const convs = listConversations()
  const waiting = convs.filter(c => (c.unread > 0) || (c.lastInboundAt && (!c.lastOutboundAt || c.lastInboundAt > c.lastOutboundAt)))
  if (!waiting.length) return '✅ Ninguém aguardando resposta — todas as conversas têm resposta sua por último.'
  return ['⏳ **Aguardando sua resposta:**', ...waiting.slice(0, 10).map(c => {
    const name = c.name || `+${c.phone}`
    const age = c.lastInboundAt ? timeAgo(c.lastInboundAt) : '?'
    const preview = (c.lastText || '').replace(/\s+/g, ' ').slice(0, 90)
    return `• **${name}** — ${age} — “${preview}”`
  })].join('\n')
}

function timeAgo(ts: number): string {
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000))
  if (mins < 60) return `há ${mins}min`
  const h = Math.floor(mins / 60)
  if (h < 48) return `há ${h}h`
  return `há ${Math.floor(h / 24)}d`
}

export function waCommandRunner(message: string): (() => Promise<string>) | null {
  const match = matchWaCommand(message)
  if (!match) return null

  if (match.kind === 'confirm') {
    return async () => {
      const p = pendingFresh()
      if (!p) return 'Não há envio pendente de confirmação (ou ele expirou — peça de novo: "JARVIS, envie para Maria …").'
      clearPending()
      return doSend(p.to, p.toName, p.text, 'confirm')
    }
  }

  if (match.kind === 'cancel') {
    return async () => {
      const p = getPending()
      if (p) { clearPending(); return `👍 Envio para ${p.toName} cancelado.` }
      return 'Não havia envio pendente.'
    }
  }

  if (match.kind === 'waiting') {
    return async () => listWaiting()
  }

  if (match.kind === 'broadcast') {
    return async () => '📣 **Não envio em massa por aqui.** A Meta proíbe mensagens em massa pela API pessoal/Cloud API sem template aprovado e sem consentimento — e não é isso que este número de testes permite. Para avisar clientes, o caminho oficial é um **template aprovado** no painel da Meta + uma lista de contatos no Centro do WhatsApp. Posso preparar o texto do template e o passo a passo — é só pedir.'
  }

  if (match.kind === 'last' && match.name) {
    return async () => {
      const r = resolveWhatsApp(match.name!)
      if (!r.phone) return noMatchMessage(match.name!, r)
      const msgs = getMessages(r.phone).filter(m => m.direction === 'in')
      const last = msgs[msgs.length - 1]
      if (!last) return `Ainda não recebi nenhuma mensagem de ${r.name}${r.source === 'contact' ? '' : ' (conversa)'}.`
      return `📩 **Última mensagem de ${r.name}** (${timeAgo(last.at)}):\n\n“${last.text}”`
    }
  }

  if (match.kind === 'summarize' && match.name) {
    return async () => {
      const r = resolveWhatsApp(match.name!)
      if (!r.phone) return noMatchMessage(match.name!, r)
      const msgs = getMessages(r.phone)
      if (!msgs.length) return `Ainda não há histórico com ${r.name}.`
      const text = await summarize({ phone: r.name || `+${r.phone}`, transcript: buildTranscript(msgs) })
      return `📋 **Resumo da conversa com ${r.name}:**\n\n${text}`
    }
  }

  if (match.kind === 'send' && match.name && match.text) {
    return async () => {
      const r = resolveWhatsApp(match.name!)
      if (!r.phone) return noMatchMessage(match.name!, r)
      // Confirmação exigida? (padrão: sim)
      const cfg = getConfig()
      if (cfg.requireConfirmSend) {
        setPending({ action: 'send', to: r.phone, toName: r.name || `+${r.phone}`, text: match.text!, createdAt: Date.now() })
        return [
          '✉️ **Confirmação de envio**',
          `Para: **${r.name}**`,
          `Mensagem: “${match.text}”`,
          '',
          'Responda **CONFIRMAR ENVIO** para enviar pela API oficial do WhatsApp, ou **cancelar envio**.',
          '(Você pode exigir/dispensar esta confirmação em Centro do WhatsApp → Preferências.)',
        ].join('\n')
      }
      return doSend(r.phone, r.name || `+${r.phone}`, match.text!, 'chat')
    }
  }

  return null
}

function noMatchMessage(name: string, r: WaResolution): string {
  if (r.candidates.length) {
    return [`Não tenho certeza de quem é “${name}”. Você quis dizer:`, ...r.candidates.map(c => `• ${c.label} (+${c.phone})`), '', 'Cadastre o apelido certo no Centro do WhatsApp → Contatos e repita.'].join('\n')
  }
  return `Não encontrei “${name}” entre seus contatos do WhatsApp. No **Centro do WhatsApp → Contatos** você pode cadastrar o apelido dele. Para enviar a um número cru, diga: “JARVIS, responda para 5511987654321 dizendo que está tudo certo”.`
}
