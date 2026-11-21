import { netIntent } from '../netlab/intent'
import { netToolRunner } from '../netlab/tools'
import { localIntent } from '../local/commands'
import { memoryIntent } from '../chat/memoryIntent'
import { promptCraftIntent } from '../chat/promptCraft'
import { looksLikeRevision } from '../studio/chat'

/**
 * Decides whether a free-form chat message should be handled by the agent runtime
 * (real work: files, commands, code) instead of the fast chat path.
 *
 * Agent mode is the default: real work goes to the agent runtime.
 * Quick conversation, media commands and Hub commands keep the fast chat path.
 */
export function shouldRunAgent(text: string, hasTopology = false): boolean {
  const t = text.trim()
  if (!t || t.startsWith('/')) return false
  if (/^(oi|olá|ola|bom dia|boa tarde|boa noite|obrigad[oa]|valeu|tudo bem)\b/i.test(t) && t.length < 40) return false

  // "lembre que…", "esqueça que…", "o que você lembra sobre mim?": memória do chat
  if (memoryIntent(t)) return false
  // "crie um prompt para…": resposta escrita pelo chat (modo engenharia de prompt)
  if (promptCraftIntent(t)) return false
  // "gere uma imagem de…", "crie um vídeo sobre…": deterministic media runner (chat route)
  if (/(?:gere|gera|crie|cria|desenhe|desenha|faça|faca|monte|produza|quero|preciso|manda|refaça|refaca)\b[^.!?]{0,40}\b(?:imagem|foto|vídeo|video|videozinho|motion|animação|animacao|logo|logotipo|wallpaper|reels|tiktok|shorts|curta|clipe)\b/i.test(t)) return false
  // "troque a voz", "deixe com 30s", "imagem nova na cena 2": ajuste do último vídeo (chat)
  if (looksLikeRevision(t)) return false
  // "refaça como comercial", "agora em animado": refaz o último vídeo noutro modelo (chat)
  if (/^(?:refaça|refaca|refaz|faça|faca|agora|transforme?|mude|troque)\b[^\n]{0,40}\b(?:em|como|estilo|no estilo)\s+(?:um\s+)?(?:animado|motion|comercial|publicit[aá]rio)\b\s*[.!]?$/i.test(t)) return false
  // Network labs, topology edits and network/server reports: handled by the chat's own network lab
  if (netIntent(t, hasTopology)) return false
  // Calculadora IP/VLSM e diagnóstico (ping, porta, DNS, traceroute): respostas exatas do chat, sem agente
  if (netToolRunner(t)) return false
  // Prospecção local (empresas e comércios próximos): resposta direta do chat
  if (localIntent(t)) return false
  // Hub Escolar sync/refresh commands
  if (/\b(?:sincroniz|atualiz)\w*\b.*\b(?:hub|faculdade|escolar|teams|github|calendário|calendario)\b/i.test(t)) return false

  // Local machine state only exists on this computer: needs tools, so go to the agent
  // ("neste computador", "nesse pc", "deste notebook"; "instalado" = software present on this machine)
  if (/\b(?:meu pc|meu computador|minha máquina|minha maquina|[nd]?(?:este|esse) (?:pc|computador|máquina|maquina|notebook)|servidor local|infraestrutura|uso de (?:cpu|ram|memória|memoria|disco)|temperatura da (?:cpu|gpu)|espaço em disco|espaco em disco|instalad[oa]s?)\b/i.test(t)) return true

  // Pure explanation stays conversation, even when it mentions files or code
  if (/^(o que (?:é|e|são|sao)|me explica|explique|explica|resuma|resume|defina|qual (?:é|e) a diferença|como funciona)(?=\s|$)/i.test(t)) return false

  const asks = /^(qual|quais|quem|quando|onde|por que|porque|como|o que|quanto|quantos|quanta|quantas|liste|lista|mostre|me diga|me diz)\b/i.test(t)
  if (asks) {
    const executes = /\b(?:crie|criar|cria|faça|faca|fazer|execute|executa|executar|rode|rodar|instale|instalar|corrija|corrigir|edite|editar|altera|alterar|mova|mover|renomeie|renomear|apague|apagar|delete|deletar|leia|ler|procure|procurar|busque|buscar|analise|analisar|verifique|verificar|teste|testar|baixe|baixar|gere|gerar|monte|montar|configure|configurar|inicie|iniciar|abra|abrir|feche|fechar|atualize|atualizar|converta|compacte|extraia)\b/i.test(t)
    const inspectsProject = /\b(?:arquivos?|pastas?|projeto|diretório|diretorio|repo(?:sitório|sitorio)?|código|codigo|planilha|documento|logs?|configuração|configuracao)\b/i.test(t)
    if (executes || inspectsProject) return true
    // Knowledge question: chat answers without tools
    return false
  }

  return true
}
