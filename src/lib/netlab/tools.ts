/**
 * Ferramentas de rede direto do chat, sem modelo de IA (respostas exatas e instantâneas):
 * - calculadora: sub-rede, divisão em partes iguais, VLSM, sumarização, hosts por prefixo;
 * - diagnóstico real a partir deste PC: ping, traceroute, DNS, teste de porta, diagnóstico completo
 *   de site/serviço e portas abertas nesta máquina.
 */
import { parseCidr, ipToInt, maskOf } from './ip'
import { blocksTable, infoText, parseNetInput, prefixForHosts, splitEqual, subnetInfo, summarize, vlsm } from './subnet'
// netdiag usa módulos do Node (dns, net, ping). Ele é INJETADO pelo servidor (commands.ts), para que
// a detecção (netToolRunner) também rode no navegador (roteador do modo agente) sem empacotá-lo.
type NetDiag = typeof import('../infra/netdiag')
export type NetDiagLoader = () => Promise<NetDiag>
const noDiag: NetDiagLoader = async () => { throw new Error('Diagnóstico de rede só roda no servidor do JARVIS') }

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const fmt = (v: number) => v.toLocaleString('pt-BR')

// ── Calculadora ──────────────────────────────────────────────────────────────

const CIDR_RE = /\b(\d{1,3}(?:\.\d{1,3}){3})\s*\/\s*(\d{1,2})\b/g
const CALC_WORDS = /\b(calcul\w*|sub-?redes?|subnet\w*|mascara|netmask|broadcast|wildcard|faixa|range|cidr|primeiro host|ultimo host|endereco de rede|quantos (hosts|ips|enderecos)|hosts? (validos|uteis)|informacoes|detalhes|explique)\b/

/** Pedidos de VLSM: "vendas 50 hosts, rh 20, ti 10" / "para 100, 50, 20 e 2 hosts". */
export function parseHostRequests(text: string): Array<{ name?: string; hosts: number }> {
  // Só o que vem depois da rede-base e sem endereços/prefixos
  const rest = text.replace(CIDR_RE, ' ').replace(/\b\d{1,3}(?:\.\d{1,3}){3}\b/g, ' ')
  const after = rest.replace(/^[\s\S]*?\b(para|pra|com|em|:)\s+/i, '')
  const parts = after.split(/\s*(?:,|;|\n|\s+e\s+|\s+and\s+)\s*/i)
  const out: Array<{ name?: string; hosts: number }> = []
  for (const p of parts) {
    const m = p.match(/(\d{1,7})/)
    if (!m) continue
    const hosts = Number(m[1])
    if (!hosts || hosts > 16_000_000) continue
    const name = p.replace(m[1], ' ')
      .replace(/\b(hosts?|maquinas?|máquinas?|usuarios?|usuários?|pcs?|computadores|dispositivos|estacoes|estações|ips?|enderecos|endereços|para|pra|com|de|da|do|a|o|sub-?redes?|redes?|vlsm|divida|divide|dividir)\b/gi, ' ')
      .replace(/[():=\-–]+/g, ' ').replace(/\s+/g, ' ').trim()
    out.push({ name: name && name.length <= 30 ? name : undefined, hosts })
  }
  return out
}

export function subnetRunner(message: string): (() => Promise<string>) | null {
  const t = norm(message.trim())
  if (!t || t.length > 1500) return null
  // "crie uma topologia com a sub-rede 10.0.0.0/24" é projeto de rede, não cálculo
  if (DESIGN_WORDS.test(t) && !/\b(calcul\w*|vlsm|sumariz\w*|divid\w*|subdivid\w*)\b/.test(t)) return null
  const cidrs = [...message.matchAll(CIDR_RE)].map(m => parseCidr(`${m[1]}/${m[2]}`)).filter((c): c is NonNullable<typeof c> => !!c)

  // Sumarização: duas ou mais redes
  if (/\b(sumariz\w*|resum\w* (as )?(rotas|redes)|agreg\w*|supernet|super-?rede|rota (resumida|sumarizada))\b/.test(t) && cidrs.length >= 2) {
    return async () => {
      const s = summarize(cidrs)
      return [
        `🧮 **Sumarização de ${cidrs.length} redes** → \`${s.network}/${s.prefix}\``,
        '',
        cidrs.map(c => `- ${c.text}`).join('\n'),
        '',
        s.exact ? '✅ Sumarização exata: a rota resumida cobre só essas redes.' : `⚠️ A rota resumida também cobre **${fmt(s.extra)}** endereços que não estão na lista — confira se eles não pertencem a outro lugar (risco de rota para o destino errado).`,
      ].join('\n')
    }
  }

  // Quantos hosts num prefixo / que prefixo para N hosts
  const onlyPrefix = !cidrs.length && t.match(/\b(?:quantos?\s+(?:hosts|ips|enderecos)\s+(?:tem|cabem|ha|possui|suporta)\s+(?:(?:n?uma?|em\s+uma?|no|na|o|a)\s+)?(?:(?:rede|mascara|sub-?rede|prefixo)\s+)?\/\s*(\d{1,2})|\/\s*(\d{1,2})\s+(?:tem|possui|suporta)\s+quantos\s+(?:hosts|ips|enderecos))\b/)
  if (onlyPrefix) {
    const p = Number(onlyPrefix[1] || onlyPrefix[2])
    if (p <= 32) return async () => {
      const i = subnetInfo(0, p)
      return `🧮 Um **/${p}** (máscara \`${i.mask}\`) tem **${fmt(i.total)}** endereços e **${fmt(i.usable)}** hosts utilizáveis${p < 31 ? ' (menos rede e broadcast)' : ''}.`
    }
  }
  const forHosts = t.match(/\b(?:qual|que)\s+(?:mascara|prefixo|sub-?rede|cidr)\b.{0,30}?\b(\d{1,7})\s*(?:hosts|maquinas|ips|dispositivos|computadores|usuarios)\b/)
  if (forHosts && !cidrs.length) {
    const h = Number(forHosts[1])
    return async () => {
      const p = prefixForHosts(h)
      const i = subnetInfo(0, p)
      return `🧮 Para **${fmt(h)}** hosts use um **/${p}** (máscara \`${i.mask}\`): ${fmt(i.usable)} hosts utilizáveis, sobram ${fmt(i.usable - h)} para crescer.${p > 0 ? ` Um /${p + 1} teria só ${fmt(Math.max(0, 2 ** (31 - p) - 2))}.` : ''}`
    }
  }

  const base = parseNetInput(message)
  if (!base) return null
  const baseNet = { network: (base.ip & maskOf(base.prefix)) >>> 0, prefix: base.prefix }

  // VLSM: rede + lista de hosts
  if (/\b(vlsm|hosts?\b.*\b(cada|para|por)\b|(divid|separ|distribu|planej|reparta|aloque|aloca)\w*.*\bhosts?\b)/.test(t) && /\bhosts?|maquinas|usuarios|dispositivos|computadores\b/.test(t)) {
    const reqs = parseHostRequests(message)
    if (reqs.length) return async () => {
      const r = vlsm(baseNet, reqs)
      return [
        `🧮 **VLSM em ${subnetInfo(baseNet.network, baseNet.prefix).network}/${baseNet.prefix}** — ${reqs.length} sub-rede(s), do maior pedido para o menor (${r.usedPct}% da rede usada)`,
        '',
        blocksTable(r.blocks, true),
        r.free.length ? `\n**Livre para crescer:** ${r.free.map(b => `\`${b.network}/${b.prefix}\``).join(', ')}` : '\nA rede foi usada por inteiro.',
        '\n*O gateway costuma ser o primeiro host de cada faixa.*',
      ].join('\n')
    }
  }

  // Divisão em partes iguais: "divida em 4 sub-redes" / "divida em /27"
  const split = t.match(/\b(divid|separ|quebr|subdivid|segment|reparta|fatie)\w*\b.*?\b(?:em|para)\s+(?:(\d{1,4})\s*(?:sub-?redes|partes|redes|blocos|segmentos|vlans|pedacos)|\/\s*(\d{1,2}))/)
  if (split) {
    return async () => {
      const r = splitEqual({ network: baseNet.network, prefix: baseNet.prefix }, split[3] ? { newPrefix: Number(split[3]) } : { parts: Number(split[2]) })
      const shown = r.blocks.slice(0, 64)
      return [
        `🧮 **${subnetInfo(baseNet.network, baseNet.prefix).network}/${baseNet.prefix}** dividida em **${fmt(r.blocks.length)}** sub-redes /${r.blocks[0].prefix} (${fmt(r.blocks[0].usable)} hosts cada)`,
        r.note ? `\n${r.note}` : '',
        '',
        blocksTable(shown),
        r.blocks.length > shown.length ? `\n… e mais ${fmt(r.blocks.length - shown.length)} sub-redes no mesmo padrão.` : '',
      ].filter(Boolean).join('\n')
    }
  }

  // Cálculo simples de uma rede
  if (CALC_WORDS.test(t) || /^\s*\d{1,3}(\.\d{1,3}){3}\s*(\/\s*\d{1,2}|\s+\d{1,3}(\.\d{1,3}){3})\s*\??\s*$/.test(t)) {
    return async () => infoText(subnetInfo(base.ip, base.prefix, base.input))
  }
  return null
}

// ── Diagnóstico ──────────────────────────────────────────────────────────────

const FILE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|md|png|jpe?g|gif|csv|json|ya?ml|tsx?|jsx?|py|exe|zip|rar|mp[34]|wav|html?|css|log|ini|cfg|bat|ps1|sh)$/i

/** Primeiro alvo de rede citado: URL, IP[:porta] ou domínio[:porta]. */
export function findTarget(message: string): string | null {
  const url = message.match(/\bhttps?:\/\/[^\s<>"'`)]+/i)
  if (url) return url[0].replace(/[.,;!?]+$/, '')
  const ip = message.match(/\b(\d{1,3}(?:\.\d{1,3}){3})(?::(\d{1,5}))?\b(?!\s*\/\s*\d)/)
  if (ip && ipToInt(ip[1]) !== null) return ip[0]
  for (const m of message.matchAll(/\b((?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24})(?::(\d{1,5}))?\b/gi)) {
    if (FILE_EXT.test(m[1])) continue
    return m[0]
  }
  if (/\blocalhost(?::\d{1,5})?\b/i.test(message)) return message.match(/\blocalhost(?::\d{1,5})?\b/i)![0]
  return null
}

const DESIGN_WORDS = /\b(topologia|diagrama|projeto de rede|laboratorio|\blab\b|crie|monte|desenhe|adicione|acrescente|configure|vlan \d+ com|containerlab|eve-?ng)\b/

const verdictIcon = { ok: '✅', degradado: '⚠️', falha: '❌' } as const

export function diagRunner(message: string, nd: NetDiagLoader = noDiag): (() => Promise<string>) | null {
  const t = norm(message.trim())
  if (!t || t.length > 400 || DESIGN_WORDS.test(t)) return null

  // Portas abertas nesta máquina
  if (/\bportas?\b.*\b(abertas?|escutando|em uso|expostas?|listening|ouvindo)\b/.test(t) && /\b(neste|nesse|deste|desse|meu|minha|aqui|local|computador|pc|maquina|servidor local)\b/.test(t)) {
    return async () => {
      const { listeningPorts } = await nd()
      const ports = await listeningPorts()
      if (!ports.length) return '🔍 Nenhuma porta TCP escutando foi encontrada (ou a consulta não teve permissão).'
      const exposed = ports.filter(p => p.exposed)
      const rows = ports.slice(0, 40).map(p => `| ${p.port} | ${p.address} | ${p.process} (${p.pid}) | ${p.exposed ? '🌐 rede' : '🔒 só local'} |`)
      return [
        `🔍 **${ports.length} porta(s) TCP escutando neste PC** — ${exposed.length} acessível(is) pela rede`,
        '',
        '| Porta | Endereço | Processo (PID) | Exposição |',
        '|---|---|---|---|',
        ...rows,
        ports.length > 40 ? `\n… e mais ${ports.length - 40}.` : '',
        exposed.length ? '\n*"rede" = escuta em todas as interfaces (0.0.0.0/::) ou num IP da rede: outras máquinas podem tentar conectar. O firewall do Windows ainda pode bloquear.*' : '',
      ].filter(Boolean).join('\n')
    }
  }

  const target = findTarget(message)
  if (!target) return null

  // Porta específica: "teste a porta 443 de site.com" / "site.com:5432 está aberta?"
  const portWord = t.match(/\bporta\s+(\d{1,5})\b/)
  const hostPort = /:(\d{1,5})$/.test(target) && !/^https?:/i.test(target)
  if ((portWord || hostPort) && /\b(test\w*|verifi\w*|cheq\w*|chec\w*|abert\w*|fechad\w*|escut\w*|respond\w*|conect\w*|acess\w*|esta|ta)\b/.test(t)) {
    return async () => {
      const { parseTarget, dnsCheck, tcpCheck } = await nd()
      const tg = parseTarget(target)
      const port = portWord ? Number(portWord[1]) : tg.port!
      if (!(port > 0 && port < 65536)) return `Porta inválida: ${port}`
      const [d, r] = await Promise.all([dnsCheck(tg.host), tcpCheck(tg.host, port, 5000)])
      if (!d.ok) return `❌ **${tg.host}** não resolve no DNS: ${d.error}`
      return r.ok
        ? `✅ **${tg.host}:${port}** está **aberta** — conexão TCP em ${r.latencyMs} ms${d.addresses[0] && d.addresses[0] !== tg.host ? ` (${d.addresses[0]})` : ''}.`
        : `❌ **${tg.host}:${port}** — ${r.error}${r.code ? ` \`${r.code}\`` : ''}.`
    }
  }

  // Ping
  if (/\b(ping\w*|pingu\w*|pinga\w*)\b/.test(t)) {
    return async () => {
      const { parseTarget, ping } = await nd()
      const tg = parseTarget(target)
      const r = await ping(tg.host, 4)
      if (!r.ok) return `❌ **${tg.host}** não respondeu ao ping (${r.sent} enviados, 0 recebidos). ${r.error || ''}\n\n*Muitos servidores e firewalls bloqueiam ICMP: peça "teste a porta 443 de ${tg.host}" para checar o serviço.*`
      const q = (r.avgMs ?? 0) < 30 ? 'excelente' : (r.avgMs ?? 0) < 80 ? 'boa' : (r.avgMs ?? 0) < 150 ? 'aceitável' : 'alta'
      const ms = (v?: number) => (v ?? 0).toLocaleString('pt-BR', { maximumFractionDigits: 1 })
      return `${r.lossPct ? '⚠️' : '✅'} **Ping ${tg.host}**: ${r.received}/${r.sent} respostas · perda **${r.lossPct}%** · mín ${ms(r.minMs)} / **média ${ms(r.avgMs)}** / máx ${ms(r.maxMs)} ms (latência ${q}${r.maxMs! - r.minMs! > 50 ? ', com variação (jitter) alta' : ''}).`
    }
  }

  // Traceroute
  if (/\b(traceroute|tracert|tracerota|trace\s?route|rastre\w*\s+(a\s+)?rota|rota\s+ate|caminho\s+ate|saltos\s+ate|hops?)\b/.test(t)) {
    return async () => {
      const { parseTarget, traceroute } = await nd()
      const tg = parseTarget(target)
      const r = await traceroute(tg.host)
      if (!r.hops.length) return `❌ Traceroute até **${tg.host}** não retornou saltos.\n\n\`\`\`\n${r.raw.slice(-800)}\n\`\`\``
      const lost = r.hops.filter(h => /\*\s+\*\s+\*|esgotado|timed out/i.test(h)).length
      return [
        `🛰️ **Rota até ${tg.host}** — ${r.hops.length} salto(s)${lost ? `, ${lost} sem resposta (roteadores que não respondem ICMP são comuns)` : ''}`,
        '',
        '```',
        ...r.hops,
        '```',
      ].join('\n')
    }
  }

  // DNS
  if (/\b(dns|nslookup|dig|resolv\w*|resolucao|qual (o )?ip d[eoa])\b/.test(t)) {
    return async () => {
      const { parseTarget, dnsCheck } = await nd()
      const tg = parseTarget(target)
      const d = await dnsCheck(tg.host)
      return d.ok
        ? `✅ **${tg.host}** resolve para ${d.addresses.map(a => `\`${a}\``).join(', ')} (${d.durationMs} ms${d.durationMs > 1500 ? ' — lento; considere outro DNS como 1.1.1.1' : ''}).`
        : `❌ **${tg.host}** não resolve: ${d.error}`
    }
  }

  // Diagnóstico completo de site/serviço
  if (/\b(diagnost\w*|fora do ar|caiu|esta (no ar|online|funcionando|fora)|ta (no ar|online|funcionando|fora)|nao (abre|carrega|conecta|responde|funciona)|verifi\w* (o site|a conexao|o servidor|o servico)|test\w* (o site|a url|a conexao|o servidor|o servico)|por que .{0,30}(lento|nao))\b/.test(t)) {
    return async () => {
      const { diagnose } = await nd()
      const d = await diagnose(target)
      return [
        `${verdictIcon[d.verdict]} **Diagnóstico de ${d.target.input}** — ${d.verdict === 'ok' ? 'tudo funcionando' : d.verdict === 'degradado' ? 'funciona, com problemas' : 'falhou'}`,
        '',
        ...d.findings.map(f => `- ${f}`),
        d.probableCause ? `\n**Causa provável:** ${d.probableCause}` : '',
      ].filter(Boolean).join('\n')
    }
  }
  return null
}

/** Calculadora primeiro (não precisa de rede), depois diagnóstico. */
export function netToolRunner(message: string, nd: NetDiagLoader = noDiag) {
  return subnetRunner(message) || diagRunner(message, nd)
}
