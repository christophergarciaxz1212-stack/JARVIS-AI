import { defaultComplete, type ChatMessage } from '../agents/models'
import { defaultModelFrom, fallbackChain, getLiveCatalog } from '../ai/catalog'
import { extractJson } from '../agents/parse'
import { layoutTopology, normalizeTopology, validateTopology } from './model'
import { getTopology, newTopologyId, saveTopology } from './store'
import type { Issue, Topology } from './types'

const SCHEMA = `Responda SOMENTE com um objeto JSON neste formato (sem comentários):
{
  "title": "título curto do projeto",
  "description": "objetivo da rede em 1-2 frases",
  "zones": [{ "id": "dc", "label": "DATACENTER-PR" }],
  "nodes": [{ "id": "fw1", "label": "FortiGate-01", "type": "firewall", "vendor": "Fortinet", "model": "FortiGate 100F", "zone": "dc", "mgmt": "192.168.99.1/24",
             "ifaces": [{ "name": "port1", "ip": "200.200.200.2/29", "mode": "routed" }, { "name": "port2", "mode": "trunk", "vlans": [10, 20] }] }],
  "links": [{ "a": "fw1", "aPort": "port1", "b": "isp1", "bPort": "fa1/0", "kind": "wan", "subnet": "200.200.200.0/29" }],
  "vlans": [{ "id": 10, "name": "USUARIOS", "subnet": "10.10.10.0/24", "gateway": "10.10.10.1" }],
  "notes": ["decisões importantes de projeto"]
}
Tipos de equipamento: router, switch, l3switch, firewall, server, pc, laptop, cloud, internet, ap, loadbalancer, nas, phone, printer, camera, vm.
Tipos de link: ethernet, access, trunk, wan, ha, vpn, wireless, fiber.`

const RULES = `Regras de engenheiro de redes sênior:
- Cada cabo liga UMA porta de cada lado (aPort/bPort) e a porta não se repete em outro cabo do mesmo equipamento.
- Os dois lados de um link roteado ficam na MESMA sub-rede (ex.: /30 ou /29 entre roteadores); nenhum IP repetido; nada de endereço de rede/broadcast.
- Use nomes de interface reais da plataforma (Cisco: Gi0/0, fa1/0, e0/1; FortiGate: port1..port10; Linux: eth0; Windows: Ethernet0).
- Switches: portas de usuário em access com a VLAN; uplinks em trunk com as VLANs permitidas; VLAN de gerência separada.
- Firewalls em HA têm um link "ha" entre si. Internet/ISP aparecem como "internet" ou roteadores de operadora em zona própria.
- Agrupe os equipamentos por site/área em "zones" (ISP-INTERNET, DATACENTER, FILIAL, DMZ…).
- Entre 6 e 40 equipamentos, a menos que o usuário peça outra escala. Se ele citar equipamentos, nomes, IPs ou VLANs, use exatamente esses.`

type Llm = (messages: ChatMessage[], signal?: AbortSignal) => Promise<string>
let llm: Llm | null = null
export function setNetlabLlm(fn: Llm | null) { llm = fn }

/**
 * One designer per request: tries the JSON-capable chain until a model returns a parseable topology,
 * then keeps that model for the correction rounds (it already knows the design).
 * Before, a single default model was asked once: a model that answered anything but JSON killed the feature.
 */
function makeAsk() {
  let sticky = ''
  return async function ask(messages: ChatMessage[], signal?: AbortSignal): Promise<string> {
    if (llm) return llm(messages, signal)
    const catalog = await getLiveCatalog()
    const chain = [...new Set([sticky, ...fallbackChain(catalog, defaultModelFrom(catalog), 4, 'json')].filter(Boolean))]
    if (!chain.length) throw new Error('Conecte uma IA (Chaves de API) para o JARVIS projetar a rede')
    let last: unknown = new Error('Nenhum modelo devolveu a topologia')
    for (const model of chain) {
      try {
        const c = await defaultComplete(model, messages, signal, { json: true })
        parse(c.text)
        sticky = model
        return c.text
      } catch (e) {
        if (signal?.aborted) throw e
        last = e
      }
    }
    throw last
  }
}

function parse(text: string): Record<string, unknown> {
  const v = extractJson(text)
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('A IA não devolveu um JSON de topologia')
  return v as Record<string, unknown>
}

export interface DesignResult { topology: Topology; issues: Issue[]; rounds: number }

/** Designs (or redesigns) a topology from a request, fixing addressing/wiring errors before saving. */
export async function designTopology(request: string, opts: { baseId?: string; signal?: AbortSignal } = {}): Promise<DesignResult> {
  const base = opts.baseId ? getTopology(opts.baseId) : null
  if (opts.baseId && !base) throw new Error('Topologia para editar não encontrada')
  const ask = makeAsk()
  const messages: ChatMessage[] = [
    { role: 'system', content: `Você é um arquiteto de redes que monta laboratórios no estilo EVE-NG.\n${SCHEMA}\n${RULES}` },
    {
      role: 'user',
      content: base
        ? `Topologia atual (JSON):\n${JSON.stringify({ ...base, nodes: base.nodes.map(({ x: _x, y: _y, ...n }) => n) })}\n\nAltere conforme o pedido e devolva a topologia COMPLETA atualizada, mantendo os ids dos equipamentos que continuam:\n${request}`
        : `Projete esta rede:\n${request}`,
    },
  ]
  let raw = parse(await ask(messages, opts.signal))
  let topo = normalizeTopology(raw, { id: base?.id || newTopologyId(), createdAt: base?.createdAt, title: base?.title })
  let issues = validateTopology(topo)
  let rounds = 0
  // Correction rounds tend to rename the project ("... Corrigida"), so the first answer's name/description stay
  const named = { title: topo.title, description: topo.description }
  // One correction round with the concrete errors: models fix addressing much better when told exactly what broke
  while (issues.some(i => i.level === 'error') && rounds < 2 && topo.nodes.length) {
    rounds++
    messages.push({ role: 'assistant', content: JSON.stringify(raw) }, { role: 'user', content: `Corrija estes problemas e devolva o JSON completo:\n${issues.filter(i => i.level === 'error').map(i => `- ${i.message}`).join('\n')}` })
    try {
      raw = parse(await ask(messages, opts.signal))
      const next = normalizeTopology(raw, { id: topo.id, createdAt: topo.createdAt })
      const nextIssues = validateTopology(next)
      if (nextIssues.filter(i => i.level === 'error').length <= issues.filter(i => i.level === 'error').length) { topo = { ...next, ...named }; issues = nextIssues }
    } catch { break }
  }
  if (!topo.nodes.length) throw new Error('A IA não descreveu nenhum equipamento; descreva melhor a rede (sites, equipamentos, links)')
  // Keep the positions the user arranged for devices that still exist
  if (base) for (const n of topo.nodes) { const old = base.nodes.find(o => o.id === n.id); if (old) { n.x = old.x; n.y = old.y } }
  layoutTopology(topo)
  saveTopology(topo)
  return { topology: topo, issues, rounds }
}
