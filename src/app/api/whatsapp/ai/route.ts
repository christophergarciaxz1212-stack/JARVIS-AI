import { NextRequest } from 'next/server'
import { getMessages, normalizePhone } from '@/lib/wa/store'
import { buildTranscript, summarize, draftReply, translate, extractCommitments, extractTasks, suggestReminders } from '@/lib/wa/ai'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (e: unknown, status = 400) => Response.json({ error: e instanceof Error ? e.message : String(e) }, { status })

/** IA da conversa — aceita phone ou conversationId; alias de ações para as duas UIs. */
export async function POST(req: NextRequest) {
  let b: Record<string, unknown>
  try { b = await req.json() } catch { return fail('JSON inválido', 400) }
  const phone = normalizePhone(String(b.phone || b.conversationId || ''))
  const action = String(b.action || '')
  if (!phone || !action) return fail('phone e action são obrigatórios', 400)

  const msgs = getMessages(phone)
  if (!msgs.length) return fail('Ainda não há histórico com este contato.', 404)
  const transcript = buildTranscript(msgs.map(m => ({ direction: m.direction, text: m.text, at: m.at, mediaMime: m.mediaMime })))

  const summarizeIt = () => summarize({ phone, transcript })
  const draftIt = () => draftReply({ phone, transcript, tone: typeof (b.tone ?? (b as { tone?: string }).tone) === 'string' ? String(b.tone) : undefined })
  const translateIt = () => translate({ phone, transcript, to: typeof b.target === 'string' ? b.target : typeof b.to === 'string' ? String(b.to) : undefined })
  const commitmentsIt = () => extractCommitments({ phone, transcript })
  const tasksIt = () => extractTasks({ phone, transcript })
  const remindersIt = () => suggestReminders({ phone, transcript })

  try {
    switch (action) {
      case 'summarize': return Response.json({ ok: true, result: await summarizeIt() })
      case 'draft':
      case 'suggest_reply':
      case 'draftReply':
      case 'draft-reply': return Response.json({ ok: true, result: await draftIt() })
      case 'translate': return Response.json({ ok: true, result: await translateIt() })
      case 'commitments':
      case 'extract_commitments':
      case 'extract-commitments': return Response.json({ ok: true, result: await commitmentsIt() })
      case 'tasks':
      case 'extract_tasks':
      case 'extract-tasks': return Response.json({ ok: true, result: await tasksIt() })
      case 'reminders':
      case 'suggest_reminders':
      case 'suggest-reminders': return Response.json({ ok: true, result: await remindersIt() })
      default: return fail('Ação de IA desconhecida', 404)
    }
  } catch (e) {
    return fail(e instanceof Error ? e.message : 'Falha ao consultar a IA', 502)
  }
}
