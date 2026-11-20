/**
 * Execução da prospecção local (só no servidor): busca no OpenStreetMap e planilha.
 * A detecção do pedido fica em commands.ts (pura, usada também no navegador).
 */
import { localIntent } from './commands'
import { CATEGORY_LABELS, searchPlaces } from './places'
import { buildSpreadsheet } from '../docs/generate'

const km = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(1).replace('.', ',')} km` : `${m} m`)
const cell = (s?: string) => (s || '').replace(/\|/g, '/').replace(/\s+/g, ' ').trim()

/** Runner do chat (servidor). */
export function localCommandRunner(message: string): (() => Promise<string>) | null {
  const intent = localIntent(message)
  if (!intent) return null
  return async () => {
    if (!intent.where) return `📍 Onde devo procurar? Diga o bairro e a cidade — ex.: **"${message.trim().replace(/[?.!]+$/, '')} na Savassi, Belo Horizonte"** (pode incluir "num raio de 2 km").\n\nCategorias que entendo: ${CATEGORY_LABELS.slice(0, 20).join(', ')}… ou "todas as empresas".`
    const r = await searchPlaces({ where: intent.where, radiusM: intent.radiusM, categoryText: intent.categoryText })
    const list = intent.onlyNoSite ? r.places.filter(p => p.leadScore >= 70) : r.places
    const what = r.categories.length ? `estabelecimentos (${r.categories.join(', ')})` : 'empresas e comércios'
    if (!list.length) return `📍 Não encontrei ${what}${intent.onlyNoSite ? ' sem site' : ''} num raio de ${km(r.radiusM)} de **${r.center.label}** no OpenStreetMap.\n\nTente um raio maior ("num raio de 5 km") ou outra categoria. Em cidades menores o mapa aberto tem menos cadastros.`
    // Planilha completa (até 2000), sempre — é o que se usa para prospectar
    const sheet = await buildSpreadsheet({
      name: `Prospecção ${what} - ${r.center.label.split(',')[0]}`,
      sheets: [{
        name: 'Empresas',
        headers: ['Nome', 'Categoria', 'Lead (0-100)', 'Oportunidade', 'Telefone', 'WhatsApp', 'Site', 'E-mail', 'Instagram', 'Endereço', 'Horário', 'Distância (m)', 'Mapa'],
        rows: list.slice(0, 2000).map(p => [p.name, p.category, p.leadScore, p.leadReason, p.phone || '', p.whatsapp ? `https://wa.me/${p.whatsapp}` : '', p.website || '', p.email || '', p.instagram || '', p.address, p.hours || '', p.distanceM, p.mapsUrl]),
      }],
    })
    const top = list.slice(0, 15)
    const rows = top.map(p => `| ${cell(p.name)} | ${cell(p.category)} | ${p.leadScore} · ${cell(p.leadReason)} | ${p.phone ? cell(p.phone) : '—'}${p.whatsapp ? ` · [WhatsApp](https://wa.me/${p.whatsapp})` : ''} | ${p.website ? `[site](${p.website})` : p.instagram ? 'Instagram' : '—'} | ${km(p.distanceM)} · [mapa](${p.mapsUrl}) |`)
    const cats = new Map<string, number>()
    for (const p of r.places) cats.set(p.category, (cats.get(p.category) || 0) + 1)
    const topCats = [...cats.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => `${c} (${n})`).join(' · ')
    return [
      `📍 **${r.stats.total} ${what}** num raio de ${km(r.radiusM)} de **${r.center.label}**${r.fromCache ? ' _(busca de hoje, do cache)_' : ''}`,
      '',
      `- 🎯 **${r.stats.semSite} sem site próprio** (${r.stats.soRedeSocial} só com rede social) — os melhores leads para quem faz sites`,
      `- 📞 ${r.stats.comTelefone} com telefone · 🌐 ${r.stats.comSite} já com site`,
      topCats && !r.categories.length ? `- Mais comuns: ${topCats}` : '',
      '',
      `**${intent.onlyNoSite ? 'Sem site, ' : ''}melhores oportunidades primeiro** (${top.length} de ${list.length}):`,
      '',
      '| Empresa | Categoria | Lead | Contato | Site | Distância |',
      '|---|---|---|---|---|---|',
      ...rows,
      '',
      `📊 Planilha com todos os ${Math.min(list.length, 2000)}, com WhatsApp, e-mail, Instagram, endereço e link do mapa:`,
      '',
      `[[document:${sheet.file}]]`,
      '',
      `_Fonte: ${r.source}. O mapa aberto não tem todas as empresas de todo bairro; confirme telefone/horário antes de visitar. Peça "só as sem site", "num raio de 3 km", "academias e estúdios de pilates" ou "monte uma mensagem de abordagem para essas empresas"._`,
    ].filter(l => l !== null).join('\n')
  }
}
