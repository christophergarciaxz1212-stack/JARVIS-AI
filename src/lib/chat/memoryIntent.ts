/**
 * Pedidos de memória no chat (puro — usado também no navegador pelo shouldRunAgent):
 * - "lembre que…", "anote que…", "guarde isso: …", "não esqueça que…", "memorize…" → salvar
 * - "esqueça que…", "apague da memória…", "pode esquecer…" → apagar
 * - "o que você lembra (sobre mim)?", "liste suas memórias", "mostre a memória" → listar
 */
export type MemoryIntent =
  | { action: 'save'; content: string }
  | { action: 'forget'; query: string }
  | { action: 'list'; query?: string }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const SAVE = /^\s*(?:jarvis[\s,:]*)?(?:por favor[\s,]*)?(?:(?:se )?lembr[ea]r?(?:-se)?(?: de)?(?: que)?|lembra(?: de)?(?: que)?|anot[ea](?: ai)?(?: que)?|guard[ea](?: isso| na memoria| na sua memoria)?(?: que)?|memoriz[ea](?: que)?|salv[ea] na (?:sua )?memoria(?: que)?|grav[ea] na (?:sua )?memoria(?: que)?|nao (?:se )?esquec[ea](?: de)?(?: que)?|registr[ea] na (?:sua )?memoria(?: que)?)\b[\s,:]*([\s\S]+)$/i
// Só "esqueça QUE/SOBRE…" ou "apague da memória…": "esqueça isso, vamos falar de outra coisa" não apaga nada
const FORGET = /^\s*(?:jarvis[\s,:]*)?(?:por favor[\s,]*)?(?:(?:pode )?esquec[ea]r? (?:que|de que|sobre|o que eu (?:disse|falei)(?: sobre)?|a memoria (?:de|sobre|que))|(?:apagu?e|apaga|remov[ea]|tir[ea]|delet[ea]) da (?:sua )?memoria(?: que| o que| a| o| sobre)?)\b[\s,:]*([\s\S]*)$/i
// "o que você sabe sobre buracos negros?" é pergunta normal; só "sobre mim" ou "o que você lembra/guardou sobre X"
const LIST = /^\s*(?:jarvis[\s,:]*)?(?:o que (?:voce )?(?:lembra|sabe|guardou|memorizou|anotou)(?: de| sobre)? (?:mim|de mim|sobre mim)|o que (?:voce )?(?:lembra|guardou|memorizou|anotou|tem (?:salvo|guardado|na memoria)) (?:de|sobre) (.+?)|(?:liste|lista|mostre|mostra|ver|veja|quais sao)(?: as| suas| tuas| minhas)? (?:memorias|lembrancas|coisas que (?:voce )?(?:lembra|guardou))|(?:mostre|mostra|abra|abre) (?:a |sua )?memoria|o que tem na (?:sua )?memoria)\s*\??\s*$/i

export function memoryIntent(message: string): MemoryIntent | null {
  const raw = message.trim()
  if (raw.length > 2000) return null
  const t = norm(raw)
  // "lembre de me avisar amanhã" é lembrete com hora, não fato a memorizar — fica para o chat/agenda
  if (/^\s*(?:jarvis[\s,:]*)?(?:me )?lembr\w* (?:de )?me (?:avisar|chamar|acordar)|\b(amanha|hoje|daqui a|as \d{1,2}h|as \d{1,2}:\d{2}) (?:me )?(?:lembr|avis)/.test(t)) return null
  const list = LIST.exec(t)
  if (list) return { action: 'list', query: list[1]?.trim() || undefined }
  const forget = FORGET.exec(t)
  if (forget) {
    const q = raw.slice(raw.length - forget[1].length).trim().replace(/[.!]+$/, '')
    return q.length >= 2 ? { action: 'forget', query: q } : null
  }
  // "lembra que eu te falei do projeto?" é pergunta, não pedido para guardar
  const save = /\?\s*$/.test(raw) ? null : SAVE.exec(t)
  if (save) {
    // Mantém a grafia original (acentos, maiúsculas) do que deve ser lembrado
    const content = raw.slice(raw.length - save[1].length).trim().replace(/^(que|de|disso|isso)\s+/i, '').replace(/[.!]+$/, '')
    return content.length >= 3 ? { action: 'save', content } : null
  }
  return null
}
