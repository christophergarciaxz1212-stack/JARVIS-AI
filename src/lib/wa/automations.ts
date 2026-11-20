/**
 * JARVIS — Automações configuráveis do WhatsApp (regra por vez, ativável/desativável).
 * Nada externo é executado sem configuração explícita do usuário.
 * Auto-resposta SÓ fora do horário configurado, SÓ se o usuário ligou o interruptor
 * e escreveu o texto de resposta. Nunca envia template automaticamente.
 */
import { getConfig } from './config'
import { addReminder, listContacts, normalizePhone, type WaContact, type WaMessage } from './store'
import { sendTextMessage } from './meta'
import { isInsideWindow, windowExpiresAt } from './store'
import { publishWa } from './sse'

export interface AutomationContext {
  msg: WaMessage
  contact?: WaContact
  contactName: string
}

export interface AutomationOutcome {
  id: string
  label: string
  fired: boolean
  detail: string
}

export function isOutsideBusinessHours(now: Date, businessHours: { enabled: boolean; start: string; end: string }): boolean {
  if (!businessHours.enabled) return false
  const day = now.getDay()
  if (day === 0 || day === 6) return true // fim de semana
  const minutes = now.getHours() * 60 + now.getMinutes()
  const [sh, sm] = businessHours.start.split(':').map(Number)
  const [eh, em] = businessHours.end.split(':').map(Number)
  return minutes < sh * 60 + sm || minutes >= eh * 60 + em
}

const COMMITMENT_RE = /\b(amanh[aã]|hoje\s+[àa]s?\s*\d{1,2}(:\d{2})?h|[àa]s\s*\d{1,2}(:\d{2})?h|prazo|entregar|entrega|reuni[aã]o|compromisso|cobran[cç]a|pagar|pagamento|vence|vencimento)\b/i

/** Avalia todas as regras ligadas para uma mensagem recebida. Retorna o que disparou (para o log/UI). */
export async function runAutomations(ctx: AutomationContext): Promise<AutomationOutcome[]> {
  const cfg = getConfig()
  const outcomes: AutomationOutcome[] = []
  const text = ctx.msg.text || ''

  // 0. Remetente com estrela → importante (sinalização passiva)
  if (cfg.automations.starredSender && ctx.contact?.starred) {
    outcomes.push({ id: 'starredSender', label: 'Contato estrelado', fired: true, detail: `${ctx.contactName} é um contato estrelado — conversa marcada como importante.` })
    publishWa({ type: 'important', phone: ctx.msg.phone, reason: 'starred' })
  }

  // 1. Palavras urgentes → destaca a conversa + notifica
  if (cfg.automations.urgent && ctx.msg.direction === 'in') {
    const hit = cfg.urgentKeywords.find(k => k && text.toLowerCase().includes(k.toLowerCase()))
    if (hit) {
      outcomes.push({ id: 'urgent', label: 'Detecção de urgência', fired: true, detail: `Palavra-chave “${hit}” detectada.` })
      publishWa({ type: 'important', phone: ctx.msg.phone, reason: `palavra-chave: ${hit}` })
    } else {
      outcomes.push({ id: 'urgent', label: 'Detecção de urgência', fired: false, detail: 'Nenhuma palavra-chave.' })
    }
  }

  // 2. Compromisso/cobrança mencionado → sugere lembrete (não cria sozinho? Cria sim: é local, reversível e listado no Centro)
  if (cfg.automations.commitment && ctx.msg.direction === 'in') {
    const m = COMMITMENT_RE.exec(text)
    if (m) {
      const snippet = text.replace(/\s+/g, ' ').trim().slice(0, 140)
      addReminder(ctx.msg.phone, snippet)
      outcomes.push({ id: 'commitment', label: 'Compromisso detectado', fired: true, detail: `Lembrete criado a partir de: “${snippet}”` })
      publishWa({ type: 'reminder', phone: ctx.msg.phone, text: snippet })
    } else {
      outcomes.push({ id: 'commitment', label: 'Compromisso detectado', fired: false, detail: 'Sem menção a compromisso/cobrança.' })
    }
  }

  // 3. Documento recebido → notifica com o nome do arquivo
  if (cfg.automations.document && ctx.msg.type === 'document') {
    outcomes.push({ id: 'document', label: 'Documento recebido', fired: true, detail: `Documento de ${ctx.contactName} — id ${ctx.msg.mediaId || '?'} (${ctx.msg.mediaName || 'sem nome'})` })
    publishWa({ type: 'document', phone: ctx.msg.phone, name: ctx.msg.mediaName || 'documento' })
  }

  // 4. Pergunta detectada → sugere rascunho de resposta (não envia)
  if (cfg.automations.question && ctx.msg.direction === 'in' && /\?/.test(text)) {
    outcomes.push({ id: 'question', label: 'Pergunta sem resposta', fired: true, detail: 'Mensagem contém pergunta — o Centro oferece “Rascunhar resposta”.' })
    publishWa({ type: 'question', phone: ctx.msg.phone })
  }

  // 5. Fora do horário de atendimento → resposta automática pré-aprovada (somente se o usuário ativou)
  if (cfg.automations.outsideHours && cfg.autoReply.enabled && cfg.autoReply.text.trim() && ctx.msg.direction === 'in') {
    const now = new Date()
    if (isOutsideBusinessHours(now, cfg.businessHours)) {
      if (isInsideWindow(ctx.msg.phone)) {
        const r = await sendTextMessage(ctx.msg.phone, cfg.autoReply.text.trim())
        outcomes.push({
          id: 'outsideHours', label: 'Resposta fora de horário', fired: r.ok,
          detail: r.ok ? `Auto-resposta enviada via API (wamid ${r.wamid}).` : `Falha ao enviar auto-resposta: ${r.error}`,
        })
      } else {
        outcomes.push({ id: 'outsideHours', label: 'Resposta fora de horário', fired: false, detail: `Janela de 24h fechada (expira ${windowExpiresAt(ctx.msg.phone) ? new Date(windowExpiresAt(ctx.msg.phone)!).toLocaleString('pt-BR') : '?'}) — a Meta só aceita template aprovado.` })
      }
    } else {
      outcomes.push({ id: 'outsideHours', label: 'Resposta fora de horário', fired: false, detail: 'Dentro do horário configurado.' })
    }
  }

  return outcomes
}

/** Nome de exibição para automação (nunca vaza telefone cru). */
export function contactDisplayName(phone: string): string {
  const contacts = listContacts()
  const p = normalizePhone(phone)
  const c = contacts.find(x => x.phone === p)
  return (c?.alias || c?.name || `+${p}`).trim()
}
