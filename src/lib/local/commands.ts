/**
 * Prospecção local pelo chat: "quais padarias tem perto da Savassi, BH", "empresas sem site num raio de
 * 2 km do centro de Campinas", "levante leads de academias em Moema, São Paulo".
 * Detecção pura (usada também no navegador pelo roteador do modo agente); a busca roda no servidor.
 */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

const BUSINESS = /\b(empresas?|comercios?|lojas?|negocios?|estabelecimentos?|leads?|prospec\w*|clientes? (em potencial|para (meu|meus|vender))|fornecedor\w*|concorrent\w*|padarias?|restaurantes?|lanchonetes?|bares|cafeterias?|sorveterias?|mercados?|supermercados?|acougues?|farmacias?|academias?|barbearias?|saloes?|esteticas?|dentistas?|clinicas?|consultorios?|pet ?shops?|veterinari\w*|oficinas?|mecanicas?|autopecas|lava.?jatos?|lojas de roupas?|oticas?|joalherias?|floriculturas?|papelarias?|imobiliarias?|advogad\w*|escritorios? de advocacia|contadores|contabilidades?|escolas?|cursos|hoteis|hotel|pousadas?|lavanderias?|pizzarias?)\b/
const NEAR = /\b(perto|proxim\w*|redor|arredores|regiao|vizinhanca|bairro|raio|em volta|nas proximidades|da cidade|na cidade|no centro|em)\b/

export interface LocalIntent { where: string; radiusM?: number; categoryText: string; onlyNoSite: boolean; wantsSheet: boolean }

/** Extrai onde procurar, o raio e o filtro do pedido; null se não for um pedido de prospecção local. */
export function localIntent(message: string): LocalIntent | null {
  const raw = message.trim()
  const t = norm(raw)
  if (!t || t.length > 500 || t.startsWith('/')) return null
  if (!BUSINESS.test(t) || !NEAR.test(t)) return null
  // Pedidos de topologia/rede, vídeo ou código não são prospecção
  if (/\b(topologia|diagrama|laboratorio|video|reels|codigo|programa|crie um site para)\b/.test(t)) return null
  const ask = /\b(quais|liste|lista|listar|mostre|mostra|busque|busca|buscar|procure|procura|procurar|encontre|ache|levante|levantar|mapeie|mapear|quero|preciso|tem|existem|ha|quantas?|quantos?|prospect\w*|pesquis\w*)\b/.test(t)
  // Sem verbo também vale quando o pedido é claramente de prospecção ("empresas sem site no centro de Campinas")
  if (!ask && !/\b(sem site|leads?|prospec\w*)\b/.test(t) && !BUSINESS.test(t.split(/\s+/).slice(0, 2).join(' '))) return null
  // Raio: "num raio de 2 km", "até 800 m", "3km"
  const r = t.match(/(\d+(?:[.,]\d+)?)\s*(km|quilometros?|m|metros?)\b/)
  const radiusM = r ? Math.round(Number(r[1].replace(',', '.')) * (/^k|quil/.test(r[2]) ? 1000 : 1)) : undefined
  // Local: o que vem depois de "perto de / próximo a / em / no bairro / na região de…"
  const m = raw.match(/(?:perto d[aeo]s?|pr[oó]xim[oa]s? (?:a|ao|à|de|da|do|das|dos)|ao redor d[aeo]|em volta d[aeo]|nos arredores d[aeo]|na regi[aã]o d[aeo]|no bairro|na cidade de|no centro de|raio de [^,]*? (?:d[aeo]|em)|\bem|\bno|\bna)\s+(.+)$/i)
  let where = (m?.[1] || '').replace(/\s*(num|em um|com|de|até|ate)?\s*raio de.*$/i, '').replace(/\b(que|e|para|pra) (n[aã]o )?(tem|t[eê]m|possuem?).*$/i, '').replace(/[?.!]+$/, '').trim()
  // "no centro de Campinas" → "Centro, Campinas" (o centro, não a cidade inteira)
  const centro = raw.match(/\bno centro d[aeo]\s+(.+?)(?:\s*(?:num|em um|com|de|até|ate)?\s*raio de.*)?[?.!]*$/i)
  if (centro) where = `Centro, ${centro[1].trim()}`
  // "perto de mim / daqui": o JARVIS não sabe onde você está — pergunta o bairro e a cidade
  if (/^(mim|aqui|daqui|voc[eê]|n[oó]s|minha casa|casa)$/i.test(where)) where = ''
  // "padarias em BH" → onde = "BH"; remove categorias que sobraram no começo
  where = where.replace(/^(empresas|com[eé]rcios|lojas)\s+(?:d[aeo]\s+)?/i, '').trim()
  if (!where || where.length < 2) return { where: '', radiusM, categoryText: raw, onlyNoSite: /sem site|nao tem site|sem pagina/.test(t), wantsSheet: /planilha|excel|xlsx|csv|export/.test(t) }
  return { where: where.slice(0, 160), radiusM, categoryText: raw.replace(where, ' '), onlyNoSite: /sem site|nao (tem|tenham|possuem?) site|sem pagina/.test(t), wantsSheet: /planilha|excel|xlsx|csv|export/.test(t) }
}
