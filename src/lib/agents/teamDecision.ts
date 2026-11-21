/**
 * Decide se um pedido do chat vai para um agente só ou para uma equipe.
 *
 * O JARVIS tem 26 papéis, delegação, trava de arquivo e rodada de revisão — mas
 * o chat mandava tudo para `preset-solo`, um único fullstack. Pedir "crie um
 * sistema completo com login, banco e relatórios" caía num agente só, enquanto
 * a equipe ficava acessível apenas pelo workspace separado.
 *
 * O padrão continua sendo um agente só: é mais rápido, gasta menos cota e
 * resolve a maioria dos pedidos. A equipe entra quando o pedido tem partes que
 * se beneficiam de especialistas diferentes — e o próprio briefing pede que
 * tarefa pequena não vire planejamento desnecessário.
 *
 * Puro de propósito (sem imports de Node): testável e usado dos dois lados.
 */

export type TeamPlan = 'solo' | 'equipe'

export interface TeamChoice {
  plan: TeamPlan
  /** Frase curta dita ao usuário, em português. */
  reason: string
  /** O usuário pediu explicitamente — não foi palpite nosso. */
  explicit: boolean
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** "use uma equipe", "varios agentes", "trabalhem em paralelo" */
const PEDE_EQUIPE = /\b(equipe|time de agentes|varios agentes|multiplos agentes|multi-?agente|em paralelo|dividam?|distribua)\b/

/** "sozinho", "um agente so", "sem equipe" */
const PEDE_SOLO = /\b(sozinho|voce mesmo|um agente so|sem equipe|rapidinho|so isso)\b/

/** Sistema inteiro, não um arquivo: pede papéis diferentes trabalhando junto. */
const SISTEMA_COMPLETO = /\b(sistema|aplicacao|aplicativo|plataforma|site|portal|dashboard|api)\b[^.!?]{0,60}\b(completo|completa|inteiro|inteira|do zero|de ponta a ponta|profissional)\b/

/** Camadas distintas citadas no mesmo pedido. */
const CAMADAS = [
  /\b(frontend|front-?end|interface|tela|telas|ui)\b/,
  /\b(backend|back-?end|servidor|api|rotas?)\b/,
  /\b(banco de dados|database|sqlite|postgres|mysql|mongo|schema|migracao|migracoes)\b/,
  /\b(teste|testes|cobertura|vitest|jest)\b/,
  /\b(deploy|ci\/?cd|docker|infra|infraestrutura|pipeline)\b/,
  /\b(documentacao|readme|docs)\b/,
  /\b(autenticacao|login|cadastro|permissoes|seguranca)\b/,
  /\b(design|estilo|css|tema|identidade visual)\b/,
]

/** Lista de entregas: "a, b e c" ou itens em linhas. */
function contaEntregas(texto: string): number {
  const linhas = texto.split('\n').filter(l => /^\s*(?:[-*•]|\d+[.)])\s+\S/.test(l)).length
  if (linhas >= 3) return linhas
  // "com login, banco de dados e relatórios"
  const virgulas = (texto.match(/,/g) || []).length
  const conectores = (fold(texto).match(/\b(e tambem|alem disso|e depois|em seguida)\b/g) || []).length
  return virgulas >= 2 && /\be\b/.test(fold(texto)) ? virgulas + 1 : conectores
}

/**
 * Escolhe entre um agente e a equipe automática.
 * `undefined` como teamId no startRun liga a equipe; 'preset-solo' mantém um só.
 */
export function decideTeam(request: string): TeamChoice {
  const t = fold(request.trim())
  if (!t) return { plan: 'solo', reason: 'pedido vazio', explicit: false }

  if (PEDE_SOLO.test(t)) return { plan: 'solo', reason: 'você pediu para eu resolver sozinho', explicit: true }
  if (PEDE_EQUIPE.test(t)) return { plan: 'equipe', reason: 'você pediu uma equipe', explicit: true }

  const camadas = CAMADAS.filter(re => re.test(t)).length
  if (SISTEMA_COMPLETO.test(t) && camadas >= 1) {
    return { plan: 'equipe', reason: 'é um sistema inteiro, com partes para especialistas diferentes', explicit: false }
  }
  if (camadas >= 3) {
    return { plan: 'equipe', reason: `o pedido junta ${camadas} frentes diferentes`, explicit: false }
  }
  if (camadas >= 2 && contaEntregas(request) >= 3) {
    return { plan: 'equipe', reason: 'são várias entregas em frentes diferentes', explicit: false }
  }

  return { plan: 'solo', reason: 'dá para resolver direto, sem montar equipe', explicit: false }
}
