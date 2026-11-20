import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { dataDir } from '../agents/fsutil'
import { courseDossier, dashboard, matchCourse, refreshAlerts, searchHub, setTaskStatus } from './academic'
import { commitFile, createIssue, syncGitHub } from './github'
import { fetchIcs, importChatGpt, importGemini, importWhatsApp, indexFolder, parseIcs } from './importers'
import { formatStudyPlan } from './studyPlan'
import { hubComplete } from './llm'
import { organize, type OrganizeSummary } from './organizer'
import { applyPortalCapture, type PortalCapture } from './portal'
import { actions, alerts, allItems, conflicts, connections, courses, exams, forgetSource, getItems, hubDir, tasks, upsertItems } from './store'
import { sendTeamsMessage, syncTeams } from './teams'
import { fmtDate, normalize } from './text'
import type { Connection, HubItem, HubSource, Origin, PendingAction } from './types'

const DEFAULTS: Record<Exclude<HubSource, 'manual'>, Omit<Connection, 'status' | 'config'>> = {
  portal: { id: 'portal', name: 'Portal do Aluno (UNAMA)', mode: 'browser', notes: ['Você entra no portal numa janela do JARVIS; ele lê as páginas que você abrir e revisita essas páginas nas próximas sincronizações.', 'Sua senha nunca é digitada nem guardada pelo JARVIS.'] },
  teams: { id: 'teams', name: 'Microsoft Teams', mode: 'api', notes: ['Microsoft Graph oficial com login Microsoft (código de dispositivo).', 'Ler canais pode exigir aprovação do administrador da faculdade.'] },
  whatsapp: { id: 'whatsapp', name: 'WhatsApp', mode: 'export', notes: ['Modo recomendado: “Exportar conversa” no WhatsApp (com mídia) e importe o arquivo — oficial, sem risco.', 'Ao vivo (experimental): protocolo Web — lê os grupos que você marcar como acadêmicos; não é API oficial e pode rachar em ban da conta. Nenhum envio acontece sem a sua aprovação.', 'Responder: o JARVIS prepara a mensagem e abre o WhatsApp para você enviar.'] },
  github: { id: 'github', name: 'GitHub', mode: 'api', notes: ['API oficial com o seu token (em 🔑 Chaves de API › Ferramentas).'] },
  chatgpt: { id: 'chatgpt', name: 'ChatGPT', mode: 'export', notes: ['Histórico: exportação oficial (Configurações › Controles de dados › Exportar dados). Não há acesso em tempo real ao histórico da conta.', 'Novas perguntas usam a API da OpenAI se a chave estiver configurada.'] },
  gemini: { id: 'gemini', name: 'Google Gemini', mode: 'export', notes: ['Histórico: Google Takeout › Minha atividade › Apps do Gemini (formato JSON).', 'Novas perguntas e comparação usam a API Gemini.'] },
  calendar: { id: 'calendar', name: 'Calendários (Google/Outlook)', mode: 'feed', notes: ['Cole o “endereço secreto no formato iCal” do Google Agenda ou o link ICS publicado do Outlook.'] },
  files: { id: 'files', name: 'Pasta de materiais', mode: 'folder', notes: ['Indexa PDFs, Word, PowerPoint e textos de uma pasta do seu computador (subpastas com o nome da disciplina ajudam a organizar).'] },
}

export function listConnections(): Connection[] {
  const saved = new Map(connections.all().map(c => [c.id, c]))
  return (Object.keys(DEFAULTS) as Array<keyof typeof DEFAULTS>).map(id => ({
    ...DEFAULTS[id],
    status: 'disconnected' as const,
    config: {},
    ...saved.get(id),
    notes: DEFAULTS[id].notes,
    counts: { ...saved.get(id)?.counts, items: getItems(id).length },
  }))
}

function getConn(id: HubSource): Connection {
  return listConnections().find(c => c.id === id) || { ...DEFAULTS[id as keyof typeof DEFAULTS], status: 'disconnected', config: {} }
}

export function configure(id: HubSource, config: Record<string, unknown>) {
  const c = getConn(id)
  const next = { ...c, config: { ...c.config, ...config } }
  connections.upsert(next)
  return next
}

// ─── Log ─────────────────────────────────────────────────────────────────────

function log(message: string, source?: HubSource) {
  fs.mkdirSync(hubDir(), { recursive: true })
  fs.appendFileSync(path.join(hubDir(), 'log.jsonl'), JSON.stringify({ at: Date.now(), source, message }) + '\n')
}

export function readLog(limit = 100) {
  const f = path.join(hubDir(), 'log.jsonl')
  if (!fs.existsSync(f)) return []
  return fs.readFileSync(f, 'utf-8').split('\n').filter(Boolean).slice(-limit).reverse().map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean)
}

// ─── Ingest (every source goes through here) ─────────────────────────────────

async function ingest(source: HubSource, items: HubItem[], extra: Partial<Connection> = {}): Promise<{ added: number; total: number; organized: OrganizeSummary }> {
  const fresh = upsertItems(source, items)
  const organized = await organize(fresh)
  const c = getConn(source)
  connections.upsert({ ...c, ...extra, status: 'connected', lastSync: Date.now(), lastError: extra.lastError, counts: { ...c.counts, ...extra.counts, items: getItems(source).length } })
  log(`${c.name}: ${fresh.length} novo(s) de ${items.length}; ${organized.tasksCreated} tarefa(s), ${organized.examsCreated} prova(s) criadas${organized.aiError ? ` (IA: ${organized.aiError})` : ''}`, source)
  return { added: fresh.length, total: items.length, organized }
}

/** Ponte ao vivo (Baileys): coloca itens como se viessem do import oficial do WhatsApp. */
export async function ingestLiveWhatsApp(items: HubItem[]): Promise<{ added: number; total: number; organized: Awaited<ReturnType<typeof organize>> }> {
  return ingest('whatsapp', items, { counts: { live: 1 } })
}

function fail(source: HubSource, e: unknown): never {
  const c = getConn(source)
  const needsAuth = !!(e as { needsAuth?: boolean }).needsAuth
  connections.upsert({ ...c, status: needsAuth ? 'needs-auth' : 'error', lastError: (e as Error).message })
  log(`${c.name}: erro — ${(e as Error).message}`, source)
  throw e
}

export async function sync(source: HubSource) {
  try {
    if (source === 'github') {
      const r = await syncGitHub()
      return { ...(await ingest('github', r.items, { account: r.account, lastError: r.errors.length ? r.errors.slice(0, 3).join(' · ') : undefined })), warnings: r.errors }
    }
    if (source === 'teams') {
      const r = await syncTeams()
      return { ...(await ingest('teams', r.items, { account: r.account, lastError: r.errors.length ? r.errors.slice(0, 3).join(' · ') : undefined })), warnings: r.errors }
    }
    if (source === 'calendar') {
      const urls = (getConn('calendar').config.urls as Array<{ name: string; url: string }>) || []
      if (!urls.length) throw new Error('Adicione o link iCal de um calendário')
      const items: HubItem[] = []
      const warnings: string[] = []
      for (const u of urls) {
        try { items.push(...parseIcs(await fetchIcs(u.url), u.name || 'Calendário')) } catch (e) { warnings.push(`${u.name}: ${(e as Error).message}`) }
      }
      return { ...(await ingest('calendar', items, { lastError: warnings[0] })), warnings }
    }
    if (source === 'files') {
      const folder = String(getConn('files').config.folder || '')
      if (!folder) throw new Error('Escolha a pasta de materiais')
      return { ...(await ingest('files', await indexFolder(folder))), warnings: [] }
    }
    throw new Error(`${getConn(source).name} é atualizado por importação de arquivo ou pela janela do portal`)
  } catch (e) {
    return fail(source, e)
  }
}

export async function syncAll() {
  const out: Record<string, unknown> = {}
  for (const c of listConnections()) {
    if (c.status === 'disconnected' || c.mode === 'export' || c.mode === 'browser') continue
    try { out[c.id] = await sync(c.id) } catch (e) { out[c.id] = { error: (e as Error).message } }
  }
  return out
}

export async function importFile(source: HubSource, filePath: string, opts: { name?: string } = {}) {
  if (!fs.existsSync(filePath)) throw new Error('Arquivo não encontrado')
  try {
    if (source === 'whatsapp') {
      const r = await importWhatsApp(filePath, opts.name)
      const known = new Set(((getConn('whatsapp').config.chats as string[]) || []))
      known.add(r.chat)
      return { ...(await ingest('whatsapp', r.items, { config: { ...getConn('whatsapp').config, chats: [...known] } })), chat: r.chat, attachments: r.attachmentsSaved }
    }
    if (source === 'chatgpt') return ingest('chatgpt', await importChatGpt(filePath))
    if (source === 'gemini') return ingest('gemini', await importGemini(filePath))
    if (source === 'calendar') return ingest('calendar', parseIcs(fs.readFileSync(filePath, 'utf-8'), opts.name || path.basename(filePath)))
    throw new Error('Essa fonte não aceita importação de arquivo')
  } catch (e) {
    return fail(source, e)
  }
}

export async function portalCapture(capture: PortalCapture) {
  try {
    const r = await applyPortalCapture(capture)
    const conn = getConn('portal')
    const pages = ((conn.config.pages as Array<{ url: string; title: string }>) || []).filter(p => p.url !== capture.url)
    pages.push({ url: capture.url, title: capture.title })
    const result = await ingest('portal', r.items, { config: { ...conn.config, pages: pages.slice(-30) } })
    return { ...result, extracted: r.summary }
  } catch (e) {
    return fail('portal', e)
  }
}

export async function reorganizeAll() {
  const items = allItems().map(i => ({ ...i, analyzedAt: undefined }))
  return organize(items)
}

/** Disconnects a source; with erase also deletes everything imported from it and its tokens. */
export function disconnect(source: HubSource, erase: boolean) {
  if (erase) {
    forgetSource(source)
    if (source === 'whatsapp') fs.rmSync(path.join(hubDir(), 'files', 'whatsapp'), { recursive: true, force: true })
    // Tasks/exams found only in this source go too; ones also seen elsewhere just lose this origin
    const removed = new Set<string>()
    for (const t of tasks.all()) {
      const rest = t.origins.filter(o => o.source !== source)
      if (rest.length === t.origins.length) continue
      if (rest.length) tasks.upsert({ ...t, origins: rest })
      else { tasks.remove(t.id); removed.add(t.id) }
    }
    for (const e of exams.all()) {
      const rest = e.origins.filter(o => o.source !== source)
      if (rest.length === e.origins.length) continue
      if (rest.length) exams.upsert({ ...e, origins: rest })
      else { exams.remove(e.id); removed.add(e.id) }
    }
    for (const c of conflicts.all()) {
      const options = c.options.filter(o => o.origin.source !== source)
      if (removed.has(c.targetId) || (c.status === 'pending' && options.length < 2)) conflicts.remove(c.id)
      else if (options.length !== c.options.length) conflicts.upsert({ ...c, options })
    }
    refreshAlerts()
  } else {
    const c = getConn(source)
    connections.upsert({ ...c, status: 'disconnected' })
  }
  log(`${DEFAULTS[source as keyof typeof DEFAULTS]?.name || source}: desconectado${erase ? ' e dados apagados' : ''}`, source)
}

// ─── Actions that leave the computer: always need the user's approval ────────

export function requestAction(type: PendingAction['type'], payload: Record<string, unknown>, requestedBy: string): PendingAction {
  const title = type === 'teams-message' ? 'Enviar mensagem no Teams' : type === 'whatsapp-message' ? 'Responder no WhatsApp' : type === 'github-issue' ? `Criar issue em ${payload.repo}` : `Enviar alteração para ${payload.repo}`
  const preview = String(payload.text || payload.body || payload.content || '').slice(0, 2000)
  const a: PendingAction = { id: uuidv4(), type, title, preview, payload, requestedBy, status: 'pending', createdAt: Date.now() }
  actions.upsert(a)
  log(`Ação aguardando aprovação: ${title} (pedida por ${requestedBy})`)
  return a
}

export async function decideAction(id: string, approve: boolean): Promise<PendingAction> {
  const a = actions.get(id)
  if (!a || a.status !== 'pending') throw new Error('Ação não encontrada ou já decidida')
  a.decidedAt = Date.now()
  if (!approve) { a.status = 'denied'; actions.upsert(a); return a }
  a.status = 'approved'
  try {
    const p = a.payload as Record<string, string>
    if (a.type === 'teams-message') a.result = await sendTeamsMessage({ chatId: p.chatId, teamId: p.teamId, channelId: p.channelId, replyTo: p.replyTo, text: p.text })
    else if (a.type === 'github-issue') a.result = await createIssue(p.repo, p.title, p.body || '')
    else if (a.type === 'github-commit') a.result = await commitFile(p.repo, p.path, p.content, p.message || 'Atualização via JARVIS', p.branch || undefined)
    else if (a.type === 'whatsapp-message') {
      // Personal accounts: click-to-chat link; the user presses send inside WhatsApp
      const phone = String(p.phone || '').replace(/\D/g, '')
      a.result = `https://wa.me/${phone}?text=${encodeURIComponent(p.text || '')}`
    }
    a.status = 'done'
  } catch (e) {
    a.status = 'failed'
    a.result = (e as Error).message
  }
  actions.upsert(a)
  log(`${a.title}: ${a.status}${a.result ? ` — ${a.result.slice(0, 160)}` : ''}`)
  return a
}

// ─── Questions answered from the hub, always with sources ────────────────────

function originLine(o: Origin) {
  return `${o.source} › ${o.where}${o.author ? ` · ${o.author}` : ''}${o.at ? ` · ${new Date(o.at).toLocaleString('pt-BR')}` : ''}${o.url ? ` · ${o.url}` : ''}`
}

const WEEK = /\b(esta semana|essa semana|nesta semana|da semana|semana)\b/
const TODAY = /\b(hoje)\b/
const TOMORROW = /\b(amanha)\b/
const MONTH = /\b(este mes|esse mes|do mes|mes)\b/

/** Builds the source-numbered context for a question. */
export function hubContext(question: string, now = Date.now()) {
  const q = normalize(question)
  const sources: Array<{ n: number; origin: Origin; text: string }> = []
  const add = (origin: Origin, text: string) => { sources.push({ n: sources.length + 1, origin, text }); return sources.length }

  const lines: string[] = []
  let horizon = 0
  if (TODAY.test(q)) horizon = 1
  else if (TOMORROW.test(q)) horizon = 2
  else if (WEEK.test(q)) horizon = 7
  else if (MONTH.test(q)) horizon = 31
  if (horizon || /\b(entregar|entrega|prazo|pendente|pendencia|atrasad|prova|provas)\b/.test(q)) {
    const limit = now + (horizon || 30) * 86400_000
    const course = (id?: string) => (id ? courses.get(id)?.name || '' : '')
    const ts = tasks.all().filter(t => t.status !== 'concluida' && t.status !== 'cancelada' && (!t.due || t.due <= limit))
    const ex = exams.all().filter(e => e.date && e.date >= now - 86400_000 && e.date <= limit)
    for (const t of ts) {
      const refs = t.origins.slice(0, 3).map(o => add(o, `${t.title}${t.description ? ` — ${t.description.slice(0, 300)}` : ''}`))
      lines.push(`- Tarefa: ${t.title} (${course(t.courseId) || 'sem disciplina'}) · prazo ${fmtDate(t.due)} · ${t.status} [${refs.map(r => `F${r}`).join(', ')}]`)
    }
    for (const e of ex) {
      const refs = e.origins.slice(0, 3).map(o => add(o, `${e.title}${e.content ? ` — ${e.content.slice(0, 300)}` : ''}`))
      lines.push(`- Prova: ${e.title} (${course(e.courseId)}) · ${fmtDate(e.date)} [${refs.map(r => `F${r}`).join(', ')}]`)
    }
  }

  const courseHit = matchCourse(question)
  const hits = searchHub(question, {}, 14)
  for (const h of hits) add(h.item.origin, `${h.item.title}\n${h.item.text.slice(0, 900)}${h.item.attachments?.length ? `\nArquivos: ${h.item.attachments.map(a => a.name).join(', ')}` : ''}`)

  const text = sources.length
    ? `${lines.length ? `# Prazos e provas\n${lines.join('\n')}\n\n` : ''}# Fontes\n${sources.map(s => `[F${s.n}] (${originLine(s.origin)})\n${s.text}`).join('\n\n')}`
    : ''
  return { text, sources, course: courseHit?.name }
}

const ANSWER_RULES = `Você é o agente acadêmico do JARVIS. Responda em português do Brasil usando SOMENTE as fontes fornecidas (mensagens, portal, Teams, GitHub, históricos do ChatGPT/Gemini).
- Entregue a resposta pronta para agir: o que fazer, até quando, com quais arquivos — não um resumo genérico.
- Cite a origem de cada informação com [F1], [F2]… Nunca invente datas, requisitos ou arquivos.
- Se as fontes se contradizem (ex.: datas diferentes), mostre as duas com as fontes e peça ao estudante para decidir.
- Se a pergunta for sobre um trabalho/atividade, organize em: **O que foi solicitado**, **Objetivo**, **Requisitos**, **Prazo**, **Arquivos enviados**, **Orientações do professor**, **Onde encontrei** (lista das fontes).
- Se não houver informação suficiente, diga o que falta e de onde poderia vir (ex.: importar a conversa do WhatsApp da turma).`

export async function ask(question: string) {
  const ctx = hubContext(question)
  if (!ctx.sources.length) {
    return { answer: 'Não encontrei nada sobre isso nas fontes conectadas. Conecte ou importe mais fontes (Teams, WhatsApp, Portal…) em **Hub Escolar › Conexões**.', sources: [] }
  }
  const { text, model } = await hubComplete([
    { role: 'system', content: ANSWER_RULES },
    { role: 'user', content: `${ctx.text}\n\n# Pergunta\n${question}` },
  ])
  return { answer: text, model, sources: ctx.sources.map(s => ({ n: s.n, origin: s.origin })) }
}

/** System-prompt addition for academic questions in the normal chat. */
export function hubChatContext(question: string): string {
  const q = normalize(question)
  const academic = /\b(entregar|entrega|prova|provas|trabalho|trabalhos|atividade|atividades|prazo|professor|professora|disciplina|materia|faculdade|aula|aulas|nota|notas|falta|faltas|frequencia|semestre|teams|whatsapp|portal|unama|estudar|revisao|turma|av1|av2|np1|np2)\b/.test(q)
    || courses.all().some(c => q.includes(normalize(c.name)))
  if (!academic) return ''
  const ctx = hubContext(question)
  if (!ctx.sources.length) return '\n\n# Hub Escolar\nNenhuma fonte acadêmica conectada ainda. Se a pergunta for sobre a faculdade, diga isso e sugira conectar fontes em Hub Escolar › Conexões.'
  return `\n\n${ANSWER_RULES}\n\n# Hub Escolar — dados reais do estudante\n${ctx.text.slice(0, 24_000)}`
}

// ─── Chat commands ───────────────────────────────────────────────────────────

/** Recognises Hub commands in a chat message; the returned runner does the work (inside the stream). */
export function hubCommandRunner(message: string): (() => Promise<string>) | null {
  const s = normalize(message).replace(/^\s*jarvis[\s,]*/, '')
  const done = /\b(marque|marcar|marca|coloque)\b\s+(?:o |a |os |as )?(?:trabalho |atividade |tarefa )?(.+?)\s+como\s+(concluid|feit|entregue)/.exec(s)
  const syncing = /\b(sincroniz|atualiz)\w*\b.*\b(hub|faculdade|escolar|teams|github|calendario)\b/.test(s)
  // "crie um vídeo … para estudar" é um pedido de conteúdo, não do plano de estudos do Hub
  const makingContent = /\b(crie|cria|criar|gere|gera|gerar|faca|faz|fazer|produza|monte|escreva|edite)\b.*\b(videos?|reels?|shorts?|imagem|imagens|foto|post|posts|roteiro|site|apresentacao|slides?|comercial|anuncio|planilha|documento)\b/.test(s)
  const studying = !makingContent && /\b(estudar|estude|plano de estudos|me organize|resumo da semana|resumo academico)\b/.test(s)
  if (!done && !syncing && !studying) return null
  return async () => (await hubCommand(message)) || 'Feito.'
}

export async function hubCommand(message: string): Promise<string | null> {
  const s = normalize(message).replace(/^\s*jarvis[\s,]*/, '')
  const done = /\b(marque|marcar|marca|coloque)\b\s+(?:o |a |os |as )?(?:trabalho |atividade |tarefa )?(.+?)\s+como\s+(concluid|feit|entregue)/.exec(s)
  if (done) {
    const target = done[2].trim()
    const t = tasks.all().filter(x => x.status !== 'concluida').map(x => ({ x, score: normalize(x.title).includes(target) || target.includes(normalize(x.title)) ? 2 : 0 })).sort((a, b) => b.score - a.score)[0]
    if (!t || !t.score) return `Não encontrei uma tarefa pendente com “${target}”. Veja a lista em Hub Escolar › Tarefas.`
    setTaskStatus(t.x.id, 'concluida')
    return `✅ Marquei como concluída: **${t.x.title}**.`
  }
  if (/\b(sincroniz|atualiz)\w*\b.*\b(hub|faculdade|escolar|teams|github|calendario)\b/.test(s)) {
    const r = await syncAll()
    return `🔄 Sincronização concluída:\n${Object.entries(r).map(([k, v]) => `- ${k}: ${(v as { error?: string; added?: number }).error || `${(v as { added?: number }).added ?? 0} novidade(s)`}`).join('\n') || '- nenhuma fonte automática conectada'}`
  }
  if (/\b(estudar|estude|plano de estudos|me organize)\b/.test(s)) return formatStudyPlan()
  if (/\b(resumo da semana|resumo academico)\b/.test(s)) return weeklySummary()
  return null
}

/** Resumo da semana acadêmica — tudo determinístico, sempre funciona, cita as mesmas fontes do Hub. */
export function weeklySummary(now = Date.now()): string {
  const day = 86_400_000
  const cs = courses.all()
  const courseById = new Map(cs.map(c => [c.id, c.name] as const))
  const ex = exams.all().filter(e => e.date && e.date >= now && e.date <= now + 7 * day).sort((a, b) => a.date! - b.date!)
  const ts = tasks.all().filter(t => t.status === 'pendente' || t.status === 'atrasada')
    .filter(t => t.due && t.due <= now + 7 * day).sort((a, b) => a.due! - b.due!)
  const late = tasks.all().filter(t => t.status === 'atrasada')
  const cand = actions.all().filter(a => a.status === 'pending')
  const confs = conflicts.all().filter(c => c.status === 'pending')
  const low = cs.filter(c => (c.attendance?.absences ?? 0) >= 3)

  const lines: string[] = ['## 🗓️ Resumo acadêmico (próximos 7 dias)', '']
  lines.push(`**Provas:** ${ex.length || 'nenhuma'}${ex.length ? ' · ' + ex.map(e => `${e.title} (${new Date(e.date!).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`).join(' · ') : ''}`)
  lines.push(`**Entregas:** ${ts.length || 'nenhuma'}${ts.length ? ' · ' + ts.slice(0, 6).map(t => `${t.title} (${new Date(t.due!).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`).join(' · ') : ''}`)
  if (late.length) lines.push(`**Atrasadas:** ${late.length} — ${late.slice(0, 3).map(t => t.title).join(' · ')}`)
  if (cand.length) lines.push(`**Aguardando sua aprovação (${cand.length}):** ${cand.slice(0, 3).map(a => a.title).join(' · ')}`)
  if (confs.length) lines.push(`**Datas conflitantes (${confs.length}):** resolva em Hub Escolar › Conflitos`)
  if (low.length) lines.push(`**Frequência:** ${low.map(c => `${c.name} (${c.attendance!.absences} falta(s))`).join(' · ')}`)
  const disciplineGaps = cs.filter(c => !itemsByCourse(c.id)).map(c => c.name)
  if (disciplineGaps.length) lines.push(`**Sem material nas fontes:** ${disciplineGaps.join(', ')} — importe a conversa do WhatsApp no Hub Escolar › Conexões`)
  if (!ex.length && !ts.length && !late.length) lines.push('', 'Nada urgente esta semana — aproveite para adiantar revisões.')
  lines.push('', '_Origem: Hub Escolar (portal/WhatsApp/Teams/GitHub). Os prazos vêm das mensagens e páginas capturadas._')
  return lines.join('\n')
}

function itemsByCourse(courseId: string): boolean {
  return allItems().some(i => i.courseId === courseId)
}

// ─── Background sync (desktop app open) ──────────────────────────────────────

const g = globalThis as unknown as { __jarvisHubTimer?: ReturnType<typeof setInterval>; __jarvisHubLast?: number }
/** Background sync on the interval chosen in ⚙️ Configurações › Hub Escolar. */
export function startHubScheduler() {
  if (g.__jarvisHubTimer || process.env.VITEST) return
  g.__jarvisHubLast = Date.now()
  g.__jarvisHubTimer = setInterval(async () => {
    const { getPrefs } = await import('../prefs')
    const p = getPrefs().hub
    if (!p.autoSync || Date.now() - (g.__jarvisHubLast || 0) < p.syncMinutes * 60_000) return
    g.__jarvisHubLast = Date.now()
    void syncAll().catch(() => {})
  }, 60_000)
  g.__jarvisHubTimer.unref?.()
}

export { dashboard, courseDossier, searchHub, alerts, dataDir }
