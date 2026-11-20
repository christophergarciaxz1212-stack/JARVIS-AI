import fs from 'fs'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addOrMergeExam, addOrMergeTask, dashboard, ensureCourse, matchCourse, refreshAlerts, resolveConflict, searchHub } from '@/lib/hub/academic'
import { ask, decideAction, disconnect, hubChatContext, hubCommand, hubCommandRunner, importFile, requestAction, sync } from '@/lib/hub/hub'
import { indexFolder, parseChatGptExport, parseGeminiActivity, parseIcs, parseWhatsAppExport } from '@/lib/hub/importers'
import { setHubLlm } from '@/lib/hub/llm'
import { organize } from '@/lib/hub/organizer'
import { actions, alerts, allItems, conflicts, courses, exams, getItems, hubDir, studies, tasks, upsertItems } from '@/lib/hub/store'
import { Bm25, extractDates } from '@/lib/hub/text'
import type { HubItem } from '@/lib/hub/types'
import { executeTool, type ToolHost } from '@/lib/agents/tools'
import type { ChatMessage } from '@/lib/agents/models'
import { completion, tempProject } from './helpers'

const MODELS = async () => ['groq|openai/gpt-oss-120b']
// Thursday, 12 Nov 2026, 10:00
const REF = new Date(2026, 10, 12, 10, 0)

function resetHub() {
  fs.rmSync(hubDir(), { recursive: true, force: true })
}

function wa(i: number, text: string, author = 'Prof. Ana', at = REF.getTime()): HubItem {
  return { id: `wa-t${i}`, source: 'whatsapp', kind: 'message', title: `${author} em Turma BD`, text, origin: { source: 'whatsapp', where: 'Turma BD', author, at, ref: `exportação · mensagem ${i}` }, importedAt: Date.now() }
}

describe('Hub Escolar: leitura das exportações oficiais', () => {
  it('lê exportação do WhatsApp Android (pt-BR), com mensagens de várias linhas e anexos', () => {
    const raw = [
      '12/11/2026 09:00 - As mensagens e ligações são protegidas com a criptografia de ponta a ponta.',
      '12/11/2026 09:15 - Prof. Ana: Pessoal, a AV1 de Banco de Dados será dia 20/11 às 19h',
      'Conteúdo: modelagem ER e SQL básico',
      '12/11/2026 09:20 - João: Trabalho_BD.pdf (arquivo anexado)',
      '12/11/2026 09:21 - Maria: <Arquivo de mídia oculto>',
    ].join('\n')
    const msgs = parseWhatsAppExport(raw)
    expect(msgs).toHaveLength(3)
    expect(msgs[0].author).toBe('Prof. Ana')
    expect(msgs[0].text).toContain('modelagem ER')
    expect(new Date(msgs[0].at).getHours()).toBe(9)
    expect(msgs[1].attachments).toEqual(['Trabalho_BD.pdf'])
    expect(msgs[2].attachments[0]).toMatch(/mídia não incluída/)
  })

  it('lê exportação do WhatsApp iOS com AM/PM', () => {
    const msgs = parseWhatsAppExport('[12/11/26, 2:30:05 PM] Prof. Ana: Entrega do trabalho na sexta\n[12/11/26, 12:05:00 AM] João: ok')
    expect(msgs).toHaveLength(2)
    const d = new Date(msgs[0].at)
    expect([d.getFullYear(), d.getHours(), d.getMinutes()]).toEqual([2026, 14, 30])
    expect(new Date(msgs[1].at).getHours()).toBe(0)
  })

  it('lê conversations.json do ChatGPT seguindo o ramo atual da conversa', () => {
    const items = parseChatGptExport([{
      id: 'c1', title: 'Normalização', create_time: 1_763_000_000, update_time: 1_763_000_100, current_node: 'a',
      mapping: {
        root: { id: 'root', parent: null, message: null },
        u: { id: 'u', parent: 'root', message: { author: { role: 'user' }, content: { content_type: 'text', parts: ['O que é 3FN?'] } } },
        old: { id: 'old', parent: 'u', message: { author: { role: 'assistant' }, content: { parts: ['resposta descartada'] } } },
        a: { id: 'a', parent: 'u', message: { author: { role: 'assistant' }, content: { parts: ['Terceira forma normal…'] } } },
      },
    }])
    expect(items).toHaveLength(1)
    expect(items[0].text).toBe('Você: O que é 3FN?\n\nChatGPT: Terceira forma normal…')
    expect(items[0].origin.where).toContain('exportação oficial')
    expect(items[0].meta?.access).toBe('exportação')
  })

  it('lê a atividade do Gemini (Takeout JSON)', () => {
    const items = parseGeminiActivity(JSON.stringify([
      { header: 'Gemini Apps', title: 'Prompted Explique chaves estrangeiras', time: '2026-11-10T12:00:00.000Z', safeHtmlItem: [{ html: '<p>Uma chave estrangeira&nbsp;liga tabelas</p>' }] },
      { header: 'Gemini Apps' },
    ]), true)
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('Explique chaves estrangeiras')
    expect(items[0].text).toContain('Gemini: Uma chave estrangeira liga tabelas')
    expect(items[0].origin.at).toBe(Date.parse('2026-11-10T12:00:00.000Z'))
  })

  it('lê calendários iCal (linhas dobradas, UTC e dia inteiro)', () => {
    const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:1\r\nSUMMARY:Prova de Cálculo\\, AV2\r\nDESCRIPTION:Capítulos 1 a\r\n  3\r\nDTSTART:20261125T220000Z\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:2\r\nSUMMARY:Feriado\r\nDTSTART;VALUE=DATE:20261120\r\nEND:VEVENT\r\nEND:VCALENDAR'
    const items = parseIcs(ics, 'Agenda UNAMA')
    expect(items.map(i => i.title)).toEqual(['Prova de Cálculo, AV2', 'Feriado'])
    expect(items[0].text).toContain('Capítulos 1 a 3')
    expect(items[0].meta?.start).toBe(Date.UTC(2026, 10, 25, 22, 0, 0))
    expect(new Date(items[1].meta?.start as number).getDate()).toBe(20)
  })

  it('indexa o texto de PDFs simples em pastas de materiais', async () => {
    const dir = tempProject({
      'material.pdf': `%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n4 0 obj\n<< /Length 34 >>\nstream\nBT\n/F1 12 Tf\n50 50 Td\n(Resumo de normalizacao) Tj\nET\nendstream\nendobj\n5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n%%EOF`,
    })
    const items = await indexFolder(dir)
    expect(items).toHaveLength(1)
    expect(items[0].text).toContain('Resumo de normalizacao')
    expect(items[0].title).toBe('material.pdf')
  })
})

describe('Hub Escolar: datas e busca', () => {
  it('entende datas em português relativas à data da mensagem', () => {
    const at = (t: string) => extractDates(t, REF).map(d => [d.date.getMonth() + 1, d.date.getDate(), d.date.getHours(), d.date.getMinutes()])
    expect(at('entregar na sexta às 14h')).toEqual([[11, 13, 14, 0]])
    expect(at('a prova é dia 20')).toEqual([[11, 20, 23, 59]])
    expect(at('Trabalho para 15 de dezembro')).toEqual([[12, 15, 23, 59]])
    expect(at('amanhã tem atividade')).toEqual([[11, 13, 23, 59]])
    expect(at('entrega 05/01')).toEqual([[1, 5, 23, 59]])
    expect(extractDates('entrega 05/01', REF)[0].date.getFullYear()).toBe(2027)
    expect(at('na próxima segunda')).toEqual([[11, 16, 23, 59]])
    // Message dates go to the model in local time, as written by people
    expect(at('entrega sexta 23h')).toEqual([[11, 13, 23, 0]])
    expect(at('segunda-feira tem aula')).toEqual([[11, 16, 23, 59]])
    expect(at('segunda chamada da prova')).toEqual([])
  })

  it('BM25 encontra por prefixo e ignora acentos', () => {
    const idx = new Bm25([{ id: 'a', t: 'Lista de exercícios de normalização' }, { id: 'b', t: 'Aviso sobre a AV1' }], d => d.t)
    const hits = idx.search('exercicio normaliz')
    expect(hits[0].doc.id).toBe('a')
  })
})

describe('Hub Escolar: organização automática', () => {
  beforeEach(resetHub)

  it('com IA: cria prova e trabalho com origem, liga à disciplina e marca ações', async () => {
    ensureCourse('Banco de Dados', 'portal', { professors: ['Ana'], aliases: ['BD'] })
    const seen: string[] = []
    setHubLlm(async (model, messages: ChatMessage[]) => {
      seen.push(messages[0].content, messages[1].content)
      const items = [...messages[1].content.matchAll(/^\[(\d+)\][^\n]*\n([^\n]*)/gm)].map(m => {
        const i = Number(m[1]); const text = m[2]
        if (/AV1/.test(text)) return { i, academic: true, action: true, actionSummary: 'Estudar para a AV1', type: 'exam', course: 'Banco de Dados', title: 'AV1 de Banco de Dados', date: '2026-11-20T19:00' }
        if (/trabalho/i.test(text)) return { i, academic: true, action: true, actionSummary: 'Entregar o trabalho', type: 'task', course: 'BD', title: 'Trabalho de modelagem', date: '2026-11-18' }
        return { i, academic: false, action: false, type: 'none' }
      })
      return completion(JSON.stringify({ items }), model)
    }, MODELS)

    const fresh = upsertItems('whatsapp', [
      wa(1, 'Pessoal, a AV1 será dia 20/11 às 19h'),
      wa(2, 'O trabalho de modelagem é para o dia 18', 'Prof. Ana', REF.getTime() + 60_000),
      wa(3, 'bom dia gente', 'João'),
    ])
    const s = await organize(fresh, { now: REF.getTime() })

    expect(seen[0]).toContain('Disciplinas conhecidas: Banco de Dados')
    // Local times, as the students wrote them (not UTC)
    expect(seen[1]).toContain('datas no texto: 2026-11-18T23:59')
    expect(seen[1]).toContain('datas no texto: 2026-11-20T19:00')
    expect(s.examsCreated).toBe(1)
    expect(s.tasksCreated).toBe(1)
    const bd = courses.all().find(c => c.name === 'Banco de Dados')!
    const exam = exams.all()[0]
    expect(exam.courseId).toBe(bd.id)
    expect(new Date(exam.date!).getHours()).toBe(19)
    expect(exam.origins[0]).toMatchObject({ source: 'whatsapp', where: 'Turma BD', author: 'Prof. Ana' })
    const task = tasks.all()[0]
    expect(task).toMatchObject({ title: 'Trabalho de modelagem', status: 'pendente', courseId: bd.id })
    // Saved with the verdict, so the next sync does not analyse it again
    const stored = getItems('whatsapp')
    expect(stored.find(i => i.id === 'wa-t1')?.action).toMatchObject({ required: true, summary: 'Estudar para a AV1' })
    expect(stored.every(i => i.courseId === bd.id || i.id === 'wa-t3')).toBe(true)
    // Unchanged messages keep their analysis when imported again
    expect(upsertItems('whatsapp', [wa(1, 'Pessoal, a AV1 será dia 20/11 às 19h')])).toHaveLength(0)
  })

  it('sem IA: regras ainda encontram provas e entregas com data', async () => {
    const fresh = upsertItems('whatsapp', [wa(1, 'Prova de Cálculo dia 25/11'), wa(2, 'Entrega do relatório na sexta'), wa(3, 'Alguém tem o slide?')])
    const s = await organize(fresh, { now: REF.getTime(), useAi: false })
    expect(s.examsCreated).toBe(1)
    expect(s.tasksCreated).toBe(1)
    expect(new Date(tasks.all()[0].due!).getDate()).toBe(13)
  })

  it('a falha da IA cai nas regras sem perder nada', async () => {
    setHubLlm(async () => { throw Object.assign(new Error('429 rate limit'), { status: 429 }) }, MODELS)
    const s = await organize(upsertItems('whatsapp', [wa(1, 'Prova de Física dia 26/11')]), { now: REF.getTime() })
    expect(s.aiError).toBeTruthy()
    expect(s.examsCreated).toBe(1)
  })

  it('assignments do Teams viram tarefas e equipes viram disciplinas', async () => {
    const items: HubItem[] = [
      { id: 'tm-course', source: 'teams', kind: 'course', title: 'Engenharia de Software', text: '', origin: { source: 'teams', where: 'Engenharia de Software' }, importedAt: 1 },
      { id: 'tm-as', source: 'teams', kind: 'assignment', title: 'Diagrama de casos de uso', text: 'Entregar em PDF', origin: { source: 'teams', where: 'Engenharia de Software › Tarefas', at: REF.getTime() }, meta: { due: REF.getTime() + 3 * 86400_000 }, importedAt: 1 },
    ]
    const s = await organize(upsertItems('teams', items), { now: REF.getTime(), useAi: false })
    expect(s.tasksCreated).toBe(1)
    const c = courses.all().find(x => x.name === 'Engenharia de Software')!
    expect(tasks.all()[0]).toMatchObject({ courseId: c.id, createdBy: 'teams' })
  })

  it('datas diferentes em fontes diferentes viram um conflito para o usuário decidir', () => {
    const c = ensureCourse('Cálculo', 'user')
    addOrMergeExam({ courseId: c.id, title: 'AV2 de Cálculo', date: new Date(2026, 10, 25).getTime(), origin: { source: 'portal', where: 'Portal › Calendário' }, createdBy: 'portal' })
    const r = addOrMergeExam({ courseId: c.id, title: 'AV2 Cálculo', date: new Date(2026, 10, 27).getTime(), origin: { source: 'whatsapp', where: 'Turma', author: 'Prof. Rui' }, createdBy: 'organizer' })
    expect(r.created).toBe(false)
    expect(r.exam.origins).toHaveLength(2)
    const conflict = conflicts.all().find(x => x.status === 'pending')!
    expect(conflict.options.map(o => o.origin.source)).toEqual(['portal', 'whatsapp'])
    expect(refreshAlerts(REF.getTime()).some(a => a.id === `conflict:${conflict.id}`)).toBe(true)
    resolveConflict(conflict.id, conflict.options[1].value)
    expect(new Date(exams.get(r.exam.id)!.date!).getDate()).toBe(27)
    expect(refreshAlerts(REF.getTime()).some(a => a.id === `conflict:${conflict.id}`)).toBe(false)
  })

  it('alertas de prazo, atraso e prova próxima; dispensar é respeitado', () => {
    const now = REF.getTime()
    const { task: soon } = addOrMergeTask({ title: 'Relatório final', due: now + 12 * 3600_000, origin: { source: 'manual', where: 'Você' }, createdBy: 'user' })
    const { task: late } = addOrMergeTask({ title: 'Lista 3', due: now - 3600_000, origin: { source: 'manual', where: 'Você' }, createdBy: 'user' })
    addOrMergeExam({ title: 'Prova de Redes', date: now + 30 * 3600_000, origin: { source: 'manual', where: 'Você' }, createdBy: 'user' })
    const list = refreshAlerts(now)
    expect(list.find(a => a.id === `task:${soon.id}:24h`)?.level).toBe('urgent')
    expect(list.some(a => a.id === `task:${late.id}:late`)).toBe(true)
    expect(tasks.get(late.id)!.status).toBe('atrasada')
    expect(list.some(a => a.id.startsWith('exam:') && a.id.endsWith(':48h'))).toBe(true)

    alerts.upsert({ ...list.find(a => a.id === `task:${soon.id}:24h`)!, dismissed: true })
    expect(refreshAlerts(now).find(a => a.id === `task:${soon.id}:24h`)?.dismissed).toBe(true)

    const d = dashboard(now)
    expect(d.weekTasks.map(t => t.title)).toEqual(['Lista 3', 'Relatório final'])
    expect(d.alerts.some(a => a.id === `task:${soon.id}:24h`)).toBe(false)
  })

  it('reconhece a disciplina pelo nome do grupo ou pelo professor', () => {
    ensureCourse('Banco de Dados', 'portal', { professors: ['Ana Souza'], aliases: ['BD'] })
    expect(matchCourse('vamos estudar?', { source: 'whatsapp', where: 'BD 2026.2' })?.name).toBe('Banco de Dados')
    expect(matchCourse('aula de banco de dados amanhã')?.name).toBe('Banco de Dados')
    expect(matchCourse('bom dia', { source: 'whatsapp', where: 'Família' })).toBeUndefined()
  })
})

describe('Hub Escolar: perguntas, comandos, ações e agentes', () => {
  beforeEach(resetHub)
  afterEach(() => vi.unstubAllGlobals())

  it('responde "o que tenho para entregar esta semana?" citando as fontes', async () => {
    const now = Date.now()
    addOrMergeTask({ title: 'Trabalho de modelagem ER', due: now + 2 * 86400_000, origin: { source: 'whatsapp', where: 'Turma BD', author: 'Prof. Ana', at: now }, createdBy: 'organizer' })
    upsertItems('whatsapp', [{ ...wa(1, 'O trabalho de modelagem ER deve ter o diagrama e o script SQL'), origin: { ...wa(1, '').origin, at: now } }])
    let prompt = ''
    setHubLlm(async (model, messages) => { prompt = messages[1].content; return completion('Você precisa entregar o **Trabalho de modelagem ER** [F1].', model) }, MODELS)
    const r = await ask('O que tenho para entregar esta semana?')
    expect(r.answer).toContain('[F1]')
    expect(prompt).toContain('# Prazos e provas')
    expect(prompt).toMatch(/\[F1\] \(whatsapp › Turma BD · Prof\. Ana/)
    expect(r.sources[0].origin.where).toBe('Turma BD')
  })

  it('sem fontes, não inventa: pede para conectar', async () => {
    setHubLlm(async () => { throw new Error('não deveria chamar a IA') }, MODELS)
    const r = await ask('quando é a prova de química?')
    expect(r.sources).toHaveLength(0)
    expect(r.answer).toMatch(/Conexões/)
  })

  it('o chat normal recebe o contexto do Hub só em perguntas acadêmicas', () => {
    addOrMergeTask({ title: 'Lista de SQL', due: Date.now() + 86400_000, origin: { source: 'teams', where: 'BD › Tarefas' }, createdBy: 'teams' })
    expect(hubChatContext('qual a capital da França?')).toBe('')
    expect(hubChatContext('o que tenho para entregar amanhã?')).toContain('Lista de SQL')
  })

  it('comando no chat marca a tarefa como concluída', async () => {
    addOrMergeTask({ title: 'Relatório de Física', due: Date.now() + 86400_000, origin: { source: 'manual', where: 'Você' }, createdBy: 'user' })
    expect(hubCommandRunner('qual o clima hoje?')).toBeNull()
    expect(hubCommandRunner('Jarvis, marque o relatório de física como concluído')).toBeTypeOf('function')
    expect(await hubCommand('Jarvis, marque o relatório de física como concluído')).toContain('Relatório de Física')
    expect(tasks.all()[0].status).toBe('concluida')
  })

  it('ações externas só acontecem depois da aprovação do usuário', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const issue = requestAction('github-issue', { repo: 'aluno/projeto', title: 'Bug', body: 'detalhes' }, 'Programação')
    expect(issue.status).toBe('pending')
    expect(fetchMock).not.toHaveBeenCalled()
    expect((await decideAction(issue.id, false)).status).toBe('denied')
    expect(fetchMock).not.toHaveBeenCalled()
    await expect(decideAction(issue.id, true)).rejects.toThrow(/já decidida/)

    const msg = requestAction('whatsapp-message', { phone: '+55 (91) 99999-0000', text: 'Oi, professora!' }, 'Mensagens')
    const done = await decideAction(msg.id, true)
    expect(done.status).toBe('done')
    expect(done.result).toBe('https://wa.me/5591999990000?text=Oi%2C%20professora!')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('agentes usam as ferramentas do Hub (busca, registrar, estudo, pedir aprovação)', async () => {
    const logs: string[] = []
    const host = { root: tempProject(), agent: { name: 'Acadêmico', roleId: 'academic' }, log: (_t: string, m: string) => logs.push(m) } as unknown as ToolHost
    upsertItems('teams', [{ id: 't1', source: 'teams', kind: 'announcement', title: 'Aviso', text: 'A lista de normalização está no canal Arquivos', origin: { source: 'teams', where: 'BD › Geral', author: 'Ana' }, importedAt: 1 }])
    ensureCourse('Banco de Dados', 'teams')

    const found = await executeTool(host, { tool: 'hub_search', args: { query: 'normalização' } })
    expect(found.output).toContain('teams › BD › Geral · Ana')

    await executeTool(host, { tool: 'hub_add_task', args: { title: 'Lista de normalização', due: '2026-11-30', course: 'Banco de Dados' } })
    expect(tasks.all()[0]).toMatchObject({ title: 'Lista de normalização', courseId: courses.all()[0].id })
    expect(tasks.all()[0].origins[0].where).toBe('Registrado por Acadêmico')

    await executeTool(host, { tool: 'hub_save_study', args: { title: 'Resumo 3FN', content: '...', course: 'Banco de Dados' } })
    expect(studies.all()[0]).toMatchObject({ title: 'Resumo 3FN', createdBy: 'Acadêmico' })

    const req = await executeTool(host, { tool: 'hub_request_action', args: { type: 'teams-message', chatId: 'x', text: 'Professora, uma dúvida' } })
    expect(req.output).toMatch(/Nada foi enviado/)
    expect(actions.all()[0]).toMatchObject({ status: 'pending', requestedBy: 'Acadêmico' })
    expect(logs[0]).toMatch(/pediu aprovação/)
  })

  it('sincroniza o GitHub com o token (API simulada) e organiza os itens', async () => {
    const prev = process.env.GITHUB_TOKEN
    process.env.GITHUB_TOKEN = 'test-token'
    const routes: Record<string, unknown> = {
      '/user': { login: 'aluno' },
      '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member': [{ full_name: 'aluno/bd-projeto', name: 'bd-projeto', description: 'Trabalho de BD', html_url: 'https://github.com/aluno/bd-projeto', private: true, pushed_at: '2026-11-10T00:00:00Z', language: 'SQL', default_branch: 'main', open_issues_count: 1, owner: { login: 'aluno' } }],
      '/repos/aluno/bd-projeto/readme': '# Projeto de Banco de Dados',
      '/repos/aluno/bd-projeto/issues?state=all&per_page=30&sort=updated': [{ number: 3, title: 'Criar tabela alunos', body: null, state: 'open', html_url: 'https://github.com/aluno/bd-projeto/issues/3', user: { login: 'colega' }, created_at: '2026-11-09T00:00:00Z', updated_at: '2026-11-09T00:00:00Z', assignees: [{ login: 'aluno' }] }],
      '/repos/aluno/bd-projeto/commits?per_page=10': null,
    }
    vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
      expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
      const p = url.replace('https://api.github.com', '')
      if (!(p in routes)) return new Response('{"message":"Not Found"}', { status: 404 })
      if (routes[p] === null) return new Response('{"message":"Git Repository is empty."}', { status: 409 })
      return typeof routes[p] === 'string' ? new Response(routes[p] as string) : Response.json(routes[p])
    }))
    try {
      const r = await sync('github')
      expect(r.added).toBe(2)
      expect(r.warnings).toEqual([])
      const issue = getItems('github').find(i => i.kind === 'issue')!
      expect(issue.meta?.assignedToMe).toBe(true)
      expect(issue.origin.url).toBe('https://github.com/aluno/bd-projeto/issues/3')
      expect(searchHub('tabela alunos')[0].item.id).toBe(issue.id)
    } finally {
      process.env.GITHUB_TOKEN = prev
    }
  })

  it('importa uma exportação do WhatsApp (.txt) e apagar a fonte remove tudo dela', async () => {
    setHubLlm(async () => { throw new Error('sem IA no teste') }, MODELS)
    const dir = tempProject({ 'Conversa do WhatsApp com Turma BD.txt': `${REF.toLocaleDateString('pt-BR')} 09:15 - Prof. Ana: Prova de BD dia 20/11\n` })
    const r = await importFile('whatsapp', path.join(dir, 'Conversa do WhatsApp com Turma BD.txt'))
    expect(r).toMatchObject({ chat: 'Turma BD', added: 1 })
    expect(exams.all()).toHaveLength(1)
    // A task confirmed by another source survives, only losing the WhatsApp origin
    addOrMergeTask({ title: 'Lista de SQL', due: REF.getTime() + 86400_000, origin: { source: 'whatsapp', where: 'Turma BD' }, createdBy: 'organizer' })
    addOrMergeTask({ title: 'Lista de SQL', due: REF.getTime() + 86400_000, origin: { source: 'teams', where: 'BD › Tarefas' }, createdBy: 'teams' })
    disconnect('whatsapp', true)
    expect(getItems('whatsapp')).toHaveLength(0)
    expect(allItems()).toHaveLength(0)
    expect(exams.all()).toHaveLength(0)
    expect(tasks.all().map(t => t.origins.map(o => o.source))).toEqual([['teams']])
    // The user's original file is never touched
    expect(fs.existsSync(path.join(dir, 'Conversa do WhatsApp com Turma BD.txt'))).toBe(true)
  })
})
