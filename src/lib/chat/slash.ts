/**
 * Comandos de barra do composer.
 *
 * Um comando só entra neste catálogo se fizer alguma coisa de verdade — o que
 * aparece na lista de sugestões é exatamente o que funciona. Nada de atalho
 * registrado e não implementado.
 *
 * Puro de propósito (sem imports de Node): o composer usa para sugerir, a rota
 * de chat usa para despachar, e os testes cobrem os dois lados.
 */

/** Onde o comando é resolvido. */
export type SlashWhere =
  /** A própria interface resolve (trocar modo, abrir seletor, limpar a tela). */
  | 'cliente'
  /** Precisa do servidor (ler o que está instalado, resumir o histórico). */
  | 'servidor'

export interface SlashCommand {
  name: string
  /** Outros nomes aceitos, para quem digita em português. */
  aliases?: string[]
  /** Argumento esperado, se houver — aparece na sugestão. */
  arg?: string
  description: string
  where: SlashWhere
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'help', aliases: ['ajuda', '?'], description: 'Mostra os comandos disponíveis', where: 'cliente' },
  { name: 'plan', aliases: ['planejar'], arg: 'o que fazer', description: 'Investiga e apresenta o plano; só executa depois da sua aprovação', where: 'cliente' },
  { name: 'agent', aliases: ['agente'], arg: 'on | off', description: 'Liga ou desliga o modo agente', where: 'cliente' },
  { name: 'model', aliases: ['modelo'], arg: 'nome (opcional)', description: 'Troca o modelo de IA ou abre a lista', where: 'cliente' },
  { name: 'mode', aliases: ['modo', 'permissao'], arg: 'restrito | supervisionado | autonomo', description: 'Define quanta autonomia o agente tem', where: 'cliente' },
  { name: 'clear', aliases: ['limpar'], description: 'Começa uma conversa nova, sem o contexto anterior', where: 'cliente' },
  { name: 'status', aliases: ['estado'], description: 'Modelo, modo, projeto, memória e execução em andamento', where: 'servidor' },
  { name: 'skills', aliases: ['extensoes', 'plugins'], description: 'Skills, plugins e MCP instalados', where: 'servidor' },
  { name: 'compact', aliases: ['compactar'], description: 'Resume a conversa para liberar contexto; nenhuma mensagem é apagada', where: 'servidor' },
]

export interface ParsedSlash {
  command: SlashCommand
  /** O que veio depois do comando, já aparado. */
  arg: string
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Acha o comando pelo nome exato ou por um apelido. */
export function findCommand(name: string): SlashCommand | null {
  const n = fold(name.replace(/^\//, '').trim())
  return SLASH_COMMANDS.find(c => c.name === n || c.aliases?.some(a => fold(a) === n)) ?? null
}

/**
 * Lê "/comando resto". Devolve null quando não é um comando conhecido — assim
 * "/minha-skill faça algo" continua chegando ao roteador de skills, e uma barra
 * no meio de uma frase não vira comando.
 */
export function parseSlash(text: string): ParsedSlash | null {
  const m = /^\/([a-zA-Zà-úÀ-Ú?]+)\s*([\s\S]*)$/.exec(text.trim())
  if (!m) return null
  const command = findCommand(m[1])
  return command ? { command, arg: m[2].trim() } : null
}

/** Sugestões para o que o usuário já digitou depois da barra. */
export function suggestCommands(typed: string): SlashCommand[] {
  const q = fold(typed.replace(/^\//, '').trim())
  if (!q) return SLASH_COMMANDS
  const starts = SLASH_COMMANDS.filter(c => c.name.startsWith(q) || c.aliases?.some(a => fold(a).startsWith(q)))
  if (starts.length) return starts
  return SLASH_COMMANDS.filter(c => c.name.includes(q) || fold(c.description).includes(q))
}

/** Texto do /help — montado do catálogo, então nunca fica desatualizado. */
export function helpText(): string {
  const linhas = SLASH_COMMANDS.map(c => {
    const nome = `/${c.name}${c.arg ? ` ${c.arg}` : ''}`
    return `- \`${nome}\` — ${c.description}`
  })
  return [
    '**Comandos do JARVIS**',
    '',
    ...linhas,
    '',
    'Escreva `@` para apontar um arquivo do projeto e mandá-lo junto com a mensagem.',
  ].join('\n')
}

/** Modos de autonomia aceitos pelo /mode, já normalizados. */
export function parsePermissionArg(arg: string): 'restrito' | 'supervisionado' | 'autonomo' | null {
  const a = fold(arg.trim())
  if (!a) return null
  if ('restrito'.startsWith(a)) return 'restrito'
  if ('supervisionado'.startsWith(a)) return 'supervisionado'
  if ('autonomo'.startsWith(a)) return 'autonomo'
  return null
}

/** "on/off/ligar/desligar" do /agent. `null` = alternar. */
export function parseOnOff(arg: string): boolean | null {
  const a = fold(arg.trim())
  if (!a) return null
  if (['on', 'ligar', 'ligado', 'sim', '1', 'true'].includes(a)) return true
  if (['off', 'desligar', 'desligado', 'nao', '0', 'false'].includes(a)) return false
  return null
}

// ─── Referências a arquivos (@) ──────────────────────────────────────────────

/** Trecho sendo digitado depois de um `@`, para sugerir arquivos. null = não está num `@`. */
export function activeFileQuery(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret)
  const at = upto.lastIndexOf('@')
  if (at < 0) return null
  // Precisa estar no começo ou depois de um espaço — "email@dominio" não conta.
  if (at > 0 && !/\s/.test(upto[at - 1])) return null
  const query = upto.slice(at + 1)
  // Um espaço encerra a referência.
  if (/\s/.test(query)) return null
  return { query, start: at }
}

/** Caminhos citados com @ numa mensagem. */
export function referencedFiles(text: string): string[] {
  const out = new Set<string>()
  for (const m of text.matchAll(/(?:^|\s)@([^\s]+)/g)) {
    const p = m[1].replace(/[.,;:)]+$/, '')
    if (p) out.add(p)
  }
  return [...out]
}
