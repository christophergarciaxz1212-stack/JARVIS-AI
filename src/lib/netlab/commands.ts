import { designTopology } from './generate'
import { environmentTopology, infraReport, topologyReport } from './report'
import { getTopology } from './store'
import { netIntent } from './intent'
import { validateTopology } from './model'
import { analyzeReachability, reachText } from './reach'
import { containerlabYaml, eveNgUnl } from './export'
import { deployLab, destroyLab, detectLabTools } from './labtools'
import { saveDocumentFile } from '../docs/office'
import { netToolRunner } from './tools'
import * as netdiag from '../infra/netdiag'
import type { Issue, Topology } from './types'

function issuesText(issues: Issue[]) {
  const errors = issues.filter(i => i.level === 'error')
  const warns = issues.filter(i => i.level === 'warn')
  const infos = issues.filter(i => i.level === 'info')
  const tips = infos.length ? `💡 Sugestões de projeto:\n${infos.slice(0, 3).map(i => `- ${i.message}`).join('\n')}` : ''
  if (!errors.length && !warns.length) return ['✅ Validação: endereçamento, gateways, cabos, portas, VLANs e laços de camada 2 consistentes.', tips].filter(Boolean).join('\n')
  return [
    errors.length ? `❌ ${errors.length} erro(s) que precisam de ajuste:\n${errors.slice(0, 6).map(i => `- ${i.message}`).join('\n')}${errors.length > 6 ? `\n- … e mais ${errors.length - 6}` : ''}` : '',
    warns.length ? `⚠️ ${warns.length} ponto(s) de atenção:\n${warns.slice(0, 5).map(i => `- ${i.message}`).join('\n')}${warns.length > 5 ? `\n- … e mais ${warns.length - 5}` : ''}` : '',
    tips,
  ].filter(Boolean).join('\n')
}

function summary(t: Topology) {
  return `${t.nodes.length} equipamentos · ${t.links.length} conexões · ${t.zones.length} áreas${t.vlans.length ? ` · ${t.vlans.length} VLANs` : ''}`
}

const NEXT = '*Arraste os equipamentos para reorganizar, clique num equipamento para ver a configuração, ou peça: "adicione…", "teste a comunicação", "exporte para Containerlab / EVE-NG", "suba o laboratório", "gere o relatório desse projeto".*'

/** One line about end-to-end reachability, shown right after a design so broken paths are visible at once. */
function reachLine(t: Topology) {
  const r = analyzeReachability(t)
  if (!r.total) return ''
  const bad = r.pairs.filter(p => !p.ok)
  return `🔌 Alcance entre estações: **${r.reachable}/${r.total}** pares${bad.length ? ` — ex.: ${bad[0].from} → ${bad[0].to}: ${bad[0].reason}` : ' ✅'}`
}

/** Network & infrastructure requests handled straight from the chat (no button needed). */
export function netlabCommandRunner(message: string, lastTopology?: string): (() => Promise<string>) | null {
  // Calculadora IP/VLSM e diagnóstico real (ping, porta, DNS, traceroute…) — exatos e sem custo de IA
  const tool = netToolRunner(message, async () => netdiag)
  if (tool) return tool
  const intent = netIntent(message, !!lastTopology && !!getTopology(lastTopology))
  if (!intent) return null
  const text = message.trim()
  switch (intent) {
    case 'design':
      return async () => {
        const r = await designTopology(text)
        return `🧭 **${r.topology.title}** — ${summary(r.topology)}\n\n${r.topology.description ? `${r.topology.description}\n\n` : ''}${issuesText(r.issues)}\n${reachLine(r.topology)}\n\n[[topology:${r.topology.id}]]\n\n${NEXT}`
      }
    case 'edit':
      return async () => {
        const r = await designTopology(text, { baseId: lastTopology })
        return `🔧 Topologia atualizada — ${summary(r.topology)}\n\n${issuesText(r.issues)}\n${reachLine(r.topology)}\n\n[[topology:${r.topology.id}]]\n\n${NEXT}`
      }
    case 'topology-report':
      return async () => {
        const t = getTopology(lastTopology!)!
        const r = await topologyReport(t)
        return `📄 Documentação do projeto **${t.title}**: diagrama, áreas, VLANs, plano de endereçamento, validação, alcance entre estações e a configuração de cada equipamento — em PDF, Word, Markdown e planilha.\n\n[[document:${r.pdf.file}]]\n\n[[document:${r.docx.file}]]\n\n[[document:${r.md.file}]]\n\n[[document:${r.sheet.file}]]\n\n[[topology:${t.id}]]`
      }
    case 'validate':
      return async () => {
        const t = getTopology(lastTopology!)!
        return `${issuesText(validateTopology(t))}\n\n${reachText(analyzeReachability(t))}\n\n[[topology:${t.id}]]`
      }
    case 'export':
      return async () => {
        const t = getTopology(lastTopology!)!
        const wantEve = /eve|unl/i.test(text), wantClab = /containerlab|clab/i.test(text), both = !wantEve && !wantClab
        const out: string[] = [`📦 Exportei **${t.title}**:`]
        if (wantClab || both) {
          const c = containerlabYaml(t)
          const d = saveDocumentFile(`${t.title} containerlab`, 'yml', c.yaml)
          out.push(`\n**Containerlab** (lab que roda de verdade com Docker: roteadores FRR, switches Linux e hosts com os IPs e rotas do projeto):\n[[document:${d.file}]]`, ...c.notes.map(n => `- ${n}`))
        }
        if (wantEve || both) {
          const e = eveNgUnl(t)
          const d = saveDocumentFile(`${t.title} eve-ng`, 'unl', e.unl)
          out.push(`\n**EVE-NG** (importe em *Import lab* ou copie para \`/opt/unetlab/labs\`):\n[[document:${d.file}]]`, ...e.notes.map(n => `- ${n}`))
        }
        const tools = await detectLabTools()
        out.push(tools.containerlab && tools.docker ? '\n✅ Containerlab detectado aqui: peça **"suba o laboratório"** para iniciar.' : `\nPara rodar o lab neste PC: ${tools.detail.join(' ')} Peça "suba o laboratório" para ver o passo a passo.`)
        if (/gns3/i.test(text)) out.push(tools.gns3 ? `GNS3 ${tools.gns3} detectado: importe o arquivo do EVE-NG/Containerlab ou recrie pelos modelos do GNS3.` : 'GNS3 não está rodando neste PC (servidor local na porta 3080 não respondeu); o arquivo do EVE-NG e o do Containerlab são as opções prontas.')
        return out.join('\n')
      }
    case 'deploy':
      return async () => {
        const t = getTopology(lastTopology!)!
        const r = await deployLab(t)
        return r.ok
          ? `🚀 Laboratório **${t.title}** no ar com Containerlab.\n\n\`\`\`\n${r.message}\n\`\`\`\n\nConsole de um equipamento: \`docker exec -it clab-<lab>-<nome> sh\` (roteadores: \`vtysh\`). Peça "derrube o laboratório" para desligar.`
          : `⚠️ ${r.message}`
      }
    case 'destroy':
      return async () => {
        const t = getTopology(lastTopology!)!
        const r = await destroyLab(t)
        return r.ok ? `🧹 Laboratório **${t.title}** desligado e limpo.` : `⚠️ ${r.message}`
      }
    case 'infra-report':
      return async () => {
        const r = await infraReport()
        return `${r.summary}\n\n[[document:${r.pdf.file}]]\n\n[[topology:${r.topology.id}]]\n\n*Peça "/infra" para o painel de monitores, servidores e backups, ou "cadastre o servidor 10.0.0.5 usuário ubuntu" para incluir mais máquinas.*`
      }
    case 'env-diagram':
      return async () => {
        const t = await environmentTopology()
        return `🗺️ **${t.title}** — ${summary(t)}\n\n[[topology:${t.id}]]\n\n*Peça "relatório de rede e servidores" para o PDF completo com recomendações.*`
      }
  }
}
