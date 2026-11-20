/**
 * Comandos de barra resolvidos no servidor (`where: 'servidor'` em lib/chat/slash).
 * Devolvem markdown pronto para aparecer como resposta do JARVIS na conversa.
 *
 * Só lê estado: nenhum comando daqui altera projeto, arquivos ou configuração.
 */
import { NextRequest } from 'next/server'
import { findCommand } from '@/lib/chat/slash'
import { getEngine } from '@/lib/engine/engine'
import { getProject } from '@/lib/agents/store'
import { getRuntime } from '@/lib/agents/runtime'
import { memorySummary, readInstructions } from '@/lib/agents/projectMemory'
import { PERMISSION_LABELS } from '@/lib/agents/permissions'
import { getPrefs } from '@/lib/prefs'
import { getMessages } from '@/lib/db'
import { applyCompaction, buildTranscript, compactionPrompt, getCompaction, setCompaction } from '@/lib/chat/compact'
import { defaultComplete } from '@/lib/agents/models'
import { defaultModelFrom, getLiveCatalog } from '@/lib/ai/catalog'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KIND_LABEL: Record<string, string> = { mcp: 'MCP', skill: 'Skill', plugin: 'Plugin' }

function skillsText(): string {
  let extensions
  try {
    extensions = getEngine().list()
  } catch (e) {
    return `Não consegui ler as extensões: ${(e as Error).message}`
  }
  if (!extensions.length) {
    return '**Nada instalado ainda.**\n\nAbra o Skill Engine na barra lateral para instalar skills, plugins e servidores MCP — ou peça ao JARVIS: "instale uma ferramenta para X".'
  }

  const porTipo = new Map<string, typeof extensions>()
  for (const e of extensions) {
    const k = KIND_LABEL[e.kind] || e.kind
    porTipo.set(k, [...(porTipo.get(k) || []), e])
  }

  const blocos = [...porTipo.entries()].map(([tipo, itens]) => {
    const linhas = itens.map(e => {
      const saude = e.status === 'ok' ? '' : ` _(${e.status})_`
      const ferramentas = e.tools.length
        ? ` — ${e.tools.length} ferramenta${e.tools.length === 1 ? '' : 's'}`
        : e.skills?.length
          ? ` — ${e.skills.length} skill${e.skills.length === 1 ? '' : 's'}`
          : ''
      return `- **${e.id}**${saude}${ferramentas}\n  ${e.description.slice(0, 120)}`
    })
    return `### ${tipo} (${itens.length})\n${linhas.join('\n')}`
  })

  return `**Extensões instaladas** — ${extensions.length} no total\n\n${blocos.join('\n\n')}\n\nO agente usa isso sozinho com \`skill_find\` e \`skill_use\`.`
}

function statusText(projectId: string, sessionId: string): string {
  const linhas: string[] = ['**Estado do JARVIS**', '']

  const prefs = getPrefs()
  const modo = prefs.agentModeDefault ? 'Agente (executa de verdade)' : 'Chat (só responde)'
  const permissao = PERMISSION_LABELS[prefs.agent.permissionMode]
  linhas.push(`- **Modo:** ${modo}`)
  linhas.push(`- **Autonomia:** ${permissao.name} — ${permissao.hint}`)
  linhas.push(`- **Plan Mode padrão:** ${prefs.agent.planFirst ? 'ligado' : 'desligado'} (use \`/plan\` para uma vez só)`)
  linhas.push(`- **Passos por tarefa:** ${prefs.agent.maxSteps} · **agentes em paralelo:** ${prefs.agent.maxParallel}`)

  const project = projectId ? getProject(projectId) : undefined
  if (project?.path) {
    linhas.push('', `- **Projeto:** ${project.name}`, `  \`${project.path}\``)
    const m = memorySummary(project.id, project.path)
    const instr = readInstructions(project.path)
    linhas.push(`  Memória: ${m.filled} campo(s) preenchido(s), ${m.decisoes} decisão(ões), ${m.pendencias} pendência(s)`)
    linhas.push(`  Instruções na pasta: ${instr ? `\`${instr.file}\`` : 'nenhum arquivo (crie um `JARVIS.md`)'}`)
  } else {
    linhas.push('', '- **Projeto:** nenhuma pasta escolhida — o agente trabalha em `Documentos\\JARVIS Projetos`')
  }

  try {
    const rt = getRuntime()
    const ativo = sessionId ? rt.activeRunForSession(sessionId) : undefined
    if (ativo) {
      const r = ativo.run
      const feitas = r.tasks.filter(t => t.status === 'done').length
      linhas.push('', `- **Execução em andamento:** ${r.status} — ${feitas}/${r.tasks.length} tarefa(s), ${r.changes.length} arquivo(s) alterado(s)`)
      const pendentes = (r.approvals || []).filter(a => a.status === 'pending').length
      if (pendentes) linhas.push(`  ${pendentes} aprovação(ões) esperando você`)
    } else {
      linhas.push('', '- **Execução em andamento:** nenhuma')
    }
  } catch { /* runtime indisponível: o resto do status continua valendo */ }

  return linhas.join('\n')
}

/** Resume a conversa e guarda o ponto de corte. Nenhuma mensagem é apagada. */
async function compactText(conversationId: string, signal?: AbortSignal): Promise<string> {
  if (!conversationId) return 'Abra ou inicie uma conversa antes de compactar.'

  const todas = getMessages(conversationId)
  const { messages: atuais } = applyCompaction(conversationId, todas)
  // Conta só o que o modelo realmente recebe hoje: compactar de novo o que já
  // está resumido não liberaria nada.
  if (atuais.length < 6) {
    return 'A conversa ainda é curta — não há o que compactar. Use `/compact` quando ela ficar longa.'
  }

  const catalog = await getLiveCatalog()
  const model = defaultModelFrom(catalog)
  if (!model) return 'Nenhum modelo disponível para resumir. Configure uma chave em 🔑 Chaves de API.'

  const transcript = buildTranscript(atuais)
  const r = await defaultComplete(model, [{ role: 'user', content: compactionPrompt(transcript) }], signal)
  const summary = r.text.trim()
  if (!summary) return 'O modelo não devolveu um resumo. Tente de novo.'

  const ultima = todas[todas.length - 1]
  const anterior = getCompaction(conversationId)
  setCompaction(conversationId, {
    at: ultima.created_at,
    summary,
    covered: (anterior?.covered ?? 0) + atuais.length,
    createdAt: Date.now(),
  })

  return [
    `**Conversa compactada** — ${atuais.length} mensagem(ns) viraram um resumo.`,
    '',
    'As mensagens originais continuam aqui no histórico: o que mudou é só o que vai para o modelo daqui em diante.',
    '',
    '---',
    '',
    summary,
  ].join('\n')
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch {}

  const command = findCommand(String(body.command || ''))
  if (!command || command.where !== 'servidor') {
    return Response.json({ error: 'Comando inválido' }, { status: 400 })
  }

  try {
    if (command.name === 'compact') {
      return Response.json({ text: await compactText(String(body.conversationId || body.sessionId || ''), req.signal) })
    }
    const text = command.name === 'skills'
      ? skillsText()
      : statusText(String(body.projectId || ''), String(body.sessionId || ''))
    return Response.json({ text })
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 })
  }
}
