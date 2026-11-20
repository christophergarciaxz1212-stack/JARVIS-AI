/**
 * Prospecção local: empresas e comércios perto de um endereço, bairro ou cidade — para achar clientes
 * (ex.: quem não tem site), fornecedores ou concorrentes.
 *
 * Fonte: OpenStreetMap (dados abertos, licença ODbL — © colaboradores do OpenStreetMap), via Nominatim
 * (endereço → coordenadas) e Overpass (estabelecimentos no raio). É o equivalente legal do "Google Maps
 * Scraper": raspar o Google Maps viola os termos do Google e é bloqueado. Cobertura varia por cidade —
 * os resultados dizem quantos itens têm telefone/site para você saber o quanto confiar.
 *
 * Boas práticas das APIs públicas respeitadas: User-Agent identificado (sem dados pessoais), 1 pedido
 * por segundo no Nominatim e cache local das buscas (data/local/).
 */
import fs from 'fs'
import path from 'path'
import { dataDir, readJson, writeJsonAtomic } from '../agents/fsutil'

const UA = 'JARVIS-AI/1.1 (prospeccao local; app desktop)'
const NOMINATIM = 'https://nominatim.openstreetmap.org/search'
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter']

export interface GeoPoint { lat: number; lon: number; label: string }

export interface Place {
  id: string
  name: string
  category: string
  address: string
  phone?: string
  whatsapp?: string
  website?: string
  email?: string
  instagram?: string
  facebook?: string
  hours?: string
  lat: number
  lon: number
  distanceM: number
  /** 0–100: chance de precisar de site/presença digital (maior = melhor lead para quem vende sites) */
  leadScore: number
  leadReason: string
  osmUrl: string
  mapsUrl: string
}

// ─── Categorias (português → filtros do OpenStreetMap) ───────────────────────

interface Cat { label: string; words: RegExp; filters: string[] }
const CATS: Cat[] = [
  { label: 'Padaria', words: /padari|panifica/, filters: ['shop=bakery'] },
  { label: 'Pizzaria', words: /pizzari/, filters: ['amenity=restaurant][cuisine~"pizza"', 'amenity=fast_food][cuisine~"pizza"'] },
  { label: 'Restaurante', words: /restaurant|comida|almoco|self.?service/, filters: ['amenity=restaurant'] },
  { label: 'Lanchonete', words: /lanchonet|hamburgu|lanche|fast.?food|pastelari/, filters: ['amenity=fast_food'] },
  { label: 'Bar', words: /\bbar(es)?\b|boteco|pub\b|cervejari/, filters: ['amenity=bar', 'amenity=pub'] },
  { label: 'Cafeteria', words: /cafeteri|\bcafe(s)?\b/, filters: ['amenity=cafe'] },
  { label: 'Sorveteria', words: /sorveteri|acai|gelat/, filters: ['amenity=ice_cream', 'shop=ice_cream'] },
  { label: 'Mercado', words: /mercad|supermercad|mercearia|hortifruti|quitanda|emporio/, filters: ['shop=supermarket', 'shop=convenience', 'shop=greengrocer'] },
  { label: 'Açougue', words: /acougu/, filters: ['shop=butcher'] },
  { label: 'Farmácia', words: /farmaci|drogari/, filters: ['amenity=pharmacy', 'shop=chemist'] },
  { label: 'Academia', words: /academi|crossfit|pilates|fitness/, filters: ['leisure=fitness_centre', 'leisure=sports_centre'] },
  { label: 'Barbearia', words: /barbeari/, filters: ['shop=hairdresser][name~"barb",i'] },
  { label: 'Salão de beleza', words: /salao|saloes|cabeleire|cabelo/, filters: ['shop=hairdresser'] },
  { label: 'Estética', words: /estetic|manicure|unha|beleza|spa\b|depila/, filters: ['shop=beauty', 'shop=cosmetics'] },
  { label: 'Dentista', words: /dentist|odonto/, filters: ['amenity=dentist', 'healthcare=dentist'] },
  { label: 'Clínica / médico', words: /clinic|medic|consultori|saude/, filters: ['amenity=clinic', 'amenity=doctors', 'healthcare=clinic', 'healthcare=doctor'] },
  { label: 'Pet shop', words: /pet.?shop|petshop|banho e tosa/, filters: ['shop=pet', 'shop=pet_grooming'] },
  { label: 'Veterinário', words: /veterinari/, filters: ['amenity=veterinary'] },
  { label: 'Oficina mecânica', words: /oficina|mecanic|funilari|borrachari/, filters: ['shop=car_repair', 'shop=tyres'] },
  { label: 'Autopeças', words: /autopeca|auto pecas/, filters: ['shop=car_parts'] },
  { label: 'Lava-jato', words: /lava.?jato|lava.?rapido|lavagem/, filters: ['amenity=car_wash'] },
  { label: 'Loja de roupas', words: /roupa|moda|boutique|vestuario/, filters: ['shop=clothes', 'shop=boutique'] },
  { label: 'Calçados', words: /calcad|sapat/, filters: ['shop=shoes'] },
  { label: 'Ótica', words: /otica|oculos/, filters: ['shop=optician'] },
  { label: 'Joalheria', words: /joalheri|joia/, filters: ['shop=jewelry'] },
  { label: 'Floricultura', words: /floricultur|flores/, filters: ['shop=florist'] },
  { label: 'Papelaria', words: /papelari|grafica/, filters: ['shop=stationery', 'shop=copyshop', 'craft=printer'] },
  { label: 'Material de construção', words: /material de construcao|construcao|ferragens|madeireira/, filters: ['shop=hardware', 'shop=doityourself', 'shop=trade'] },
  { label: 'Móveis', words: /movei|moveis|decorac/, filters: ['shop=furniture', 'shop=interior_decoration'] },
  { label: 'Eletrônicos / celular', words: /eletronic|celular|informatica|assistencia tecnica/, filters: ['shop=electronics', 'shop=mobile_phone', 'shop=computer'] },
  { label: 'Imobiliária', words: /imobiliari|corretor/, filters: ['office=estate_agent'] },
  { label: 'Advocacia', words: /advoga|advocaci|juridic/, filters: ['office=lawyer'] },
  { label: 'Contabilidade', words: /contabil|contador/, filters: ['office=accountant'] },
  { label: 'Escola / curso', words: /escola|curso|idioma|ingles|autoescola|creche/, filters: ['amenity=school', 'amenity=language_school', 'amenity=driving_school', 'amenity=kindergarten', 'amenity=college'] },
  { label: 'Hotel / pousada', words: /hotel|pousada|hostel|hospedag/, filters: ['tourism=hotel', 'tourism=guest_house', 'tourism=hostel', 'tourism=motel'] },
  { label: 'Lavanderia', words: /lavanderi/, filters: ['shop=laundry', 'shop=dry_cleaning'] },
  { label: 'Igreja', words: /igreja|templo/, filters: ['amenity=place_of_worship'] },
]

/** Filtro amplo: "todas as empresas e comércios" (exclui casas, ruas e serviços públicos). */
const ALL_FILTERS = [
  'shop', 'office', 'craft',
  'amenity~"^(restaurant|cafe|fast_food|bar|pub|ice_cream|pharmacy|dentist|clinic|doctors|veterinary|car_wash|car_rental|driving_school|language_school|kindergarten|college|marketplace|fuel|bank|cinema|nightclub|coworking_space)$"',
  'leisure~"^(fitness_centre|sports_centre|dance)$"',
  'tourism~"^(hotel|guest_house|hostel|motel)$"',
  'healthcare',
]

const TAG_LABELS: Record<string, string> = {
  bakery: 'Padaria', restaurant: 'Restaurante', fast_food: 'Lanchonete', bar: 'Bar', pub: 'Bar', cafe: 'Cafeteria', ice_cream: 'Sorveteria',
  supermarket: 'Mercado', convenience: 'Conveniência', greengrocer: 'Hortifruti', butcher: 'Açougue', pharmacy: 'Farmácia', chemist: 'Farmácia',
  fitness_centre: 'Academia', sports_centre: 'Centro esportivo', hairdresser: 'Salão / barbearia', beauty: 'Estética', cosmetics: 'Cosméticos',
  dentist: 'Dentista', clinic: 'Clínica', doctors: 'Consultório', doctor: 'Consultório', pet: 'Pet shop', pet_grooming: 'Banho e tosa', veterinary: 'Veterinário',
  car_repair: 'Oficina mecânica', tyres: 'Borracharia', car_parts: 'Autopeças', car_wash: 'Lava-jato', clothes: 'Roupas', boutique: 'Boutique', shoes: 'Calçados',
  optician: 'Ótica', jewelry: 'Joalheria', florist: 'Floricultura', stationery: 'Papelaria', copyshop: 'Copiadora', hardware: 'Ferragens', doityourself: 'Material de construção',
  furniture: 'Móveis', electronics: 'Eletrônicos', mobile_phone: 'Celulares', computer: 'Informática', estate_agent: 'Imobiliária', lawyer: 'Advocacia',
  accountant: 'Contabilidade', school: 'Escola', language_school: 'Escola de idiomas', driving_school: 'Autoescola', kindergarten: 'Creche', college: 'Faculdade',
  hotel: 'Hotel', guest_house: 'Pousada', hostel: 'Hostel', motel: 'Motel', laundry: 'Lavanderia', dry_cleaning: 'Lavanderia', fuel: 'Posto', bank: 'Banco',
  place_of_worship: 'Igreja', marketplace: 'Feira', variety_store: 'Variedades', gift: 'Presentes', books: 'Livraria', bicycle: 'Bicicletaria', travel_agency: 'Agência de viagens',
  insurance: 'Seguros', company: 'Empresa', it: 'Tecnologia', coworking_space: 'Coworking', cinema: 'Cinema', nightclub: 'Balada',
}

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Categorias pedidas no texto ("padarias e cafeterias"); vazio = todas as empresas. */
export function categoriesFrom(text: string): Cat[] {
  const t = norm(text)
  return CATS.filter(c => c.words.test(t))
}
export const CATEGORY_LABELS = CATS.map(c => c.label)

// ─── Geocodificação (Nominatim, com cache e 1 pedido/s) ───────────────────────

const cacheFile = (name: string) => path.join(dataDir(), 'local', name)
let lastNominatim = 0

export async function geocode(query: string, signal?: AbortSignal): Promise<GeoPoint> {
  const q = query.trim().slice(0, 200)
  if (!q) throw new Error('Informe o endereço, bairro ou cidade')
  const coords = q.match(/^(-?\d{1,2}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)$/)
  if (coords) return { lat: Number(coords[1]), lon: Number(coords[2]), label: q }
  const cache = readJson<Record<string, GeoPoint>>(cacheFile('geocode.json'), {})
  const key = norm(q)
  if (cache[key]) return cache[key]
  const wait = 1100 - (Date.now() - lastNominatim)
  if (wait > 0) await new Promise(r => setTimeout(r, wait))
  lastNominatim = Date.now()
  const url = `${NOMINATIM}?format=jsonv2&limit=1&addressdetails=0&accept-language=pt-BR&countrycodes=br&q=${encodeURIComponent(q)}`
  let res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: signal ?? AbortSignal.timeout(15_000) })
  let list = res.ok ? await res.json() as Array<{ lat: string; lon: string; display_name: string }> : []
  if (res.ok && !list.length) {
    // Fora do Brasil
    await new Promise(r => setTimeout(r, 1100))
    res = await fetch(url.replace('&countrycodes=br', ''), { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: signal ?? AbortSignal.timeout(15_000) })
    list = res.ok ? await res.json() as typeof list : []
  }
  if (!res.ok) throw new Error(`O serviço de mapas não respondeu (${res.status}). Tente de novo em alguns segundos.`)
  if (!list.length) throw new Error(`Não encontrei "${q}" no mapa. Tente com cidade e estado (ex.: "Savassi, Belo Horizonte - MG").`)
  const p: GeoPoint = { lat: Number(list[0].lat), lon: Number(list[0].lon), label: list[0].display_name.split(',').slice(0, 4).join(',').trim() }
  cache[key] = p
  writeJsonAtomic(cacheFile('geocode.json'), cache)
  return p
}

// ─── Busca no raio (Overpass) ─────────────────────────────────────────────────

export function overpassQuery(center: GeoPoint, radiusM: number, cats: Cat[]): string {
  const around = `(around:${Math.round(radiusM)},${center.lat.toFixed(6)},${center.lon.toFixed(6)})`
  const filters = cats.length ? cats.flatMap(c => c.filters) : ALL_FILTERS
  const parts = filters.map(f => `nwr[${f}][name]${around};`).join('\n  ')
  return `[out:json][timeout:40];\n(\n  ${parts}\n);\nout center tags 1500;`
}

type OsmEl = { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }

function distance(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000, toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat), dLon = toRad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/** Só dígitos com DDI 55 quando for número brasileiro (para o link wa.me). */
export function waNumber(phone?: string) {
  if (!phone) return undefined
  const d = phone.split(/[;,/]/)[0].replace(/\D/g, '')
  if (d.length < 10) return undefined
  if (d.startsWith('55') && d.length >= 12) return d
  if (d.length === 10 || d.length === 11) return `55${d}`
  return d
}

/**
 * Pontuação de lead para quem vende site/presença digital: sem site e com telefone = melhor lead;
 * só rede social = bom; site sem https = melhoria; site próprio com https = baixo.
 */
export function leadScore(p: Pick<Place, 'website' | 'phone' | 'email' | 'instagram' | 'facebook' | 'hours'>): { score: number; reason: string } {
  const site = p.website?.trim()
  const social = !!(p.instagram || p.facebook) || (!!site && /instagram\.com|facebook\.com|linktr\.ee|wa\.me|whatsapp/i.test(site))
  const ownSite = !!site && !/instagram\.com|facebook\.com|linktr\.ee|wa\.me|whatsapp/i.test(site)
  if (!ownSite && p.phone) return { score: social ? 80 : 95, reason: social ? 'Só rede social, sem site próprio' : 'Sem site — tem telefone para contato' }
  if (!ownSite) return { score: social ? 70 : 75, reason: social ? 'Só rede social, sem site próprio' : 'Sem site e sem telefone cadastrado' }
  if (/^http:\/\//i.test(site!)) return { score: 55, reason: 'Site sem https (inseguro/antigo)' }
  return { score: 15 + (p.hours ? 0 : 10) + (p.phone ? 0 : 10), reason: 'Já tem site próprio' }
}

function toPlace(el: OsmEl, center: GeoPoint): Place | null {
  const t = el.tags || {}
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon
  if (!t.name || lat === undefined || lon === undefined) return null
  const kind = t.shop || t.amenity || t.office || t.craft || t.leisure || t.tourism || t.healthcare || ''
  const category = TAG_LABELS[kind] || (kind ? kind.replace(/_/g, ' ') : 'Empresa')
  const phone = t.phone || t['contact:phone'] || t['contact:mobile'] || t.mobile
  const website = t.website || t['contact:website'] || t.url
  const instagram = t['contact:instagram'] || t.instagram
  const facebook = t['contact:facebook'] || t.facebook
  const street = [t['addr:street'], t['addr:housenumber']].filter(Boolean).join(', ')
  const address = [street, t['addr:suburb'] || t['addr:neighbourhood'], t['addr:city']].filter(Boolean).join(' · ')
  const base = { website, phone, email: t.email || t['contact:email'], instagram, facebook, hours: t.opening_hours }
  const lead = leadScore(base)
  return {
    id: `${el.type}/${el.id}`,
    name: t.name,
    category,
    address,
    ...base,
    whatsapp: waNumber(t['contact:whatsapp'] || phone),
    lat, lon,
    distanceM: Math.round(distance(center, { lat, lon })),
    leadScore: lead.score,
    leadReason: lead.reason,
    osmUrl: `https://www.openstreetmap.org/${el.type}/${el.id}`,
    mapsUrl: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${t.name} ${lat.toFixed(6)},${lon.toFixed(6)}`)}`,
  }
}

export interface SearchResult {
  center: GeoPoint
  radiusM: number
  categories: string[]
  places: Place[]
  stats: { total: number; semSite: number; comTelefone: number; comSite: number; soRedeSocial: number }
  source: string
  fromCache: boolean
}

export async function searchPlaces(opts: { where: string; radiusM?: number; categoryText?: string; signal?: AbortSignal }): Promise<SearchResult> {
  const radiusM = Math.max(200, Math.min(15_000, Math.round(opts.radiusM || 1500)))
  const center = await geocode(opts.where, opts.signal)
  const cats = categoriesFrom(opts.categoryText || '')
  const cacheKey = `${center.lat.toFixed(4)},${center.lon.toFixed(4)}|${radiusM}|${cats.map(c => c.label).join('+') || 'todas'}`
  const cache = readJson<Record<string, { at: number; els: OsmEl[] }>>(cacheFile('places-cache.json'), {})
  let els: OsmEl[] | null = null
  let fromCache = false
  if (cache[cacheKey] && Date.now() - cache[cacheKey].at < 24 * 3600_000) { els = cache[cacheKey].els; fromCache = true }
  if (!els) {
    const query = overpassQuery(center, radiusM, cats)
    let lastErr = ''
    // Servidores públicos: 429/504 = ocupado. Tenta os dois espelhos e, se preciso, de novo após uma pausa curta
    for (let round = 0; round < 2 && !els; round++) {
      if (round) await new Promise(r => setTimeout(r, 6000))
      for (const url of OVERPASS) {
        try {
          const res = await fetch(url, { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: `data=${encodeURIComponent(query)}`, signal: opts.signal ?? AbortSignal.timeout(60_000) })
          if (!res.ok) { lastErr = `${new URL(url).host} respondeu ${res.status}${res.status === 429 ? ' (muitos pedidos — aguarde 1 minuto)' : ''}`; continue }
          els = ((await res.json()) as { elements?: OsmEl[] }).elements || []
          break
        } catch (e) {
          if (opts.signal?.aborted) throw e
          lastErr = (e as Error).name === 'TimeoutError' ? `${new URL(url).host} demorou demais` : (e as Error).message
        }
      }
    }
    if (!els) throw new Error(`Não consegui consultar o mapa agora: ${lastErr}. Tente um raio menor ou de novo em instantes.`)
    // Só o essencial no cache (sem crescer sem limite)
    const keys = Object.keys(cache)
    if (keys.length > 40) for (const k of keys.sort((a, b) => cache[a].at - cache[b].at).slice(0, keys.length - 40)) delete cache[k]
    cache[cacheKey] = { at: Date.now(), els }
    fs.mkdirSync(path.dirname(cacheFile('x')), { recursive: true })
    writeJsonAtomic(cacheFile('places-cache.json'), cache)
  }
  const seen = new Set<string>()
  const places = els.map(e => toPlace(e, center)).filter((p): p is Place => !!p)
    .filter(p => { const k = `${norm(p.name)}|${Math.round(p.lat * 2000)}|${Math.round(p.lon * 2000)}`; if (seen.has(k)) return false; seen.add(k); return true })
    .sort((a, b) => b.leadScore - a.leadScore || a.distanceM - b.distanceM)
  const ownSite = (p: Place) => !!p.website && !/instagram\.com|facebook\.com|linktr\.ee|wa\.me|whatsapp/i.test(p.website)
  return {
    center, radiusM, categories: cats.map(c => c.label), places,
    stats: {
      total: places.length,
      semSite: places.filter(p => !ownSite(p)).length,
      comTelefone: places.filter(p => p.phone).length,
      comSite: places.filter(ownSite).length,
      soRedeSocial: places.filter(p => !ownSite(p) && (p.instagram || p.facebook)).length,
    },
    source: 'OpenStreetMap (© colaboradores do OpenStreetMap, ODbL)',
    fromCache,
  }
}
