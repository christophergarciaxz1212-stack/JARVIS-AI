import type { ToolHost, ToolSpec } from '../agents/tools'
import type { ToolAction } from '../agents/parse'
import { audit } from './log'
import { getInventory } from './inventory'
import { diagnose, listeningPorts } from './netdiag'
import { getInfraCore, requestDockerAction, requestInstall, requestLocalExec, requestSshExec, selfReport } from './core'
import { execRemote, findServer, listServers, remoteInventory } from './ssh'
import { dockerAction, dockerLogs, dockerOverview } from './docker'
import { createBackup, listBackups, verifyBackup } from './backup'
import { bestGpu, ollamaStatus, recommendModels } from './ai'
import { classifyCommand, RISK_LABEL } from './risk'
import type { MonitorKind, ResourceMetric } from './monitor'

export const INFRA_TOOL_DOCS = `
Infraestrutura (Jarvis Infrastructure Core — dados reais desta máquina e dos servidores cadastrados):
- infra_inventory {} → hardware, SO, discos, GPU (VRAM/temperatura), rede, processos e ferramentas instaladas
- infra_diagnose {"target": "site.com | 10.0.0.5:5432 | https://app.com"} → diagnóstico DNS→ping→TCP→HTTP/TLS com causa provável
- infra_ports {} → portas em escuta e quais estão expostas para a rede
- infra_monitor {"op": "list|add|check|incidents", "name": "...", "kind": "http|tcp|dns|process|docker|ssh|resource", "target": "...", "interval_sec": 60, "metric": "memory|disk|cpu|gpu-temp|gpu-mem", "max": 90, "id": "..."} → monitores e incidentes do watchdog
- infra_servers {} → servidores SSH cadastrados pelo usuário
- infra_ssh {"server": "nome", "command": "systemctl status nginx"} → executa no servidor (leitura/alteração rodam; comandos destrutivos viram pedido de aprovação)
- infra_server_inventory {"server": "nome"} → SO, uptime, memória, disco, serviços com falha, portas, containers, firewall e SSH do servidor
- infra_docker {"op": "list|logs|start|restart|stop", "container": "nome"} → containers locais (stop pede aprovação)
- infra_backup {"op": "list|create|verify", "id": "...", "label": "..."} → backups com SHA-256 dos dados do JARVIS
- infra_selfcheck {} → autodiagnóstico do JARVIS (dados, memória, event loop, dependências, modelos, backups, watchdog)
- infra_ai {} → GPU/VRAM, status do Ollama, modelos instalados e quais modelos cabem nesta máquina
- infra_install {"tool": "docker|git|terraform|kubectl|helm|tailscale|..."} → pede ao usuário para instalar uma ferramenta (winget)
- infra_request {"command": "...", "reason": "..."} → pede autorização para um comando local crítico/destrutivo que run_command recusa
Regras: verifique antes de afirmar (rode o check depois de mudar algo); nunca exponha serviços, apague dados ou desative firewall sem aprovação.`

const obj = (properties: Record<string, unknown>, required: string[]) => ({ type: 'object', properties, required })
const s = (description: string) => ({ type: 'string', description })

export const INFRA_TOOL_SPECS: ToolSpec[] = [
  { name: 'infra_inventory', description: 'Inventário real da máquina: hardware, SO, discos, GPU, rede, processos, ferramentas', parameters: obj({}, []) },
  { name: 'infra_diagnose', description: 'Diagnóstico de conectividade (DNS, ping, porta TCP, HTTP/TLS) com causa provável', parameters: obj({ target: s('host, IP, host:porta ou URL') }, ['target']) },
  { name: 'infra_ports', description: 'Portas TCP em escuta e exposição à rede', parameters: obj({}, []) },
  { name: 'infra_monitor', description: 'Lista/cria/verifica monitores do watchdog e lista incidentes', parameters: obj({ op: { type: 'string', enum: ['list', 'add', 'check', 'incidents'] }, name: s('Nome'), kind: { type: 'string', enum: ['http', 'tcp', 'dns', 'process', 'docker', 'ssh', 'resource'] }, target: s('URL, host:porta, processo, container ou servidor'), interval_sec: { type: 'integer' }, metric: { type: 'string', enum: ['memory', 'disk', 'cpu', 'gpu-temp', 'gpu-mem'] }, max: { type: 'number' }, id: s('Id do monitor (check)') }, ['op']) },
  { name: 'infra_servers', description: 'Lista os servidores SSH cadastrados', parameters: obj({}, []) },
  { name: 'infra_ssh', description: 'Executa um comando em um servidor cadastrado via SSH', parameters: obj({ server: s('Nome ou id do servidor'), command: s('Comando shell') }, ['server', 'command']) },
  { name: 'infra_server_inventory', description: 'Inventário remoto de um servidor cadastrado', parameters: obj({ server: s('Nome ou id') }, ['server']) },
  { name: 'infra_docker', description: 'Containers Docker locais: listar, logs, start, restart, stop', parameters: obj({ op: { type: 'string', enum: ['list', 'logs', 'start', 'restart', 'stop'] }, container: s('Nome ou id') }, ['op']) },
  { name: 'infra_backup', description: 'Backups dos dados do JARVIS: listar, criar, verificar', parameters: obj({ op: { type: 'string', enum: ['list', 'create', 'verify'] }, id: s('Id do backup (verify)'), label: s('Rótulo (create)') }, ['op']) },
  { name: 'infra_selfcheck', description: 'Autodiagnóstico do próprio JARVIS', parameters: obj({}, []) },
  { name: 'infra_ai', description: 'GPU/VRAM, Ollama e recomendação de modelos locais', parameters: obj({}, []) },
  { name: 'infra_install', description: 'Pede ao usuário para instalar uma ferramenta via winget', parameters: obj({ tool: s('Id da ferramenta') }, ['tool']) },
  { name: 'infra_request', description: 'Pede autorização ao usuário para um comando local crítico', parameters: obj({ command: s('Comando'), reason: s('Por que é necessário') }, ['command']) },
]

export const INFRA_ARG_ALIASES: Record<string, Record<string, string[]>> = {
  infra_diagnose: { target: ['host', 'url', 'address', 'alvo'] },
  infra_ssh: { server: ['host', 'servidor', 'name'], command: ['cmd', 'comando', 'script'] },
  infra_server_inventory: { server: ['host', 'servidor', 'name'] },
  infra_docker: { container: ['name', 'id'] },
  infra_install: { tool: ['name', 'package', 'ferramenta'] },
  infra_request: { command: ['cmd', 'comando'] },
}

const mb = (n?: number) => (n === undefined ? '?' : n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n} MB`)
const str = (v: unknown, name: string) => {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Parâmetro "${name}" é obrigatório`)
  return v.trim()
}

export async function executeInfraTool(host: Pick<ToolHost, 'agent' | 'log'>, action: ToolAction): Promise<{ output: string }> {
  const a = action.args
  const actor = `agent:${host.agent.name}`
  host.log('tool', `${host.agent.name} → ${action.tool}`, { tool: action.tool })
  switch (action.tool) {
    case 'infra_inventory': {
      const inv = await getInventory()
      const tools = inv.tools.filter(t => t.path).map(t => t.id).join(', ')
      const missing = inv.tools.filter(t => !t.path).map(t => `${t.id}${t.installId ? '' : '*'}`).join(', ')
      return { output: [
        `Host: ${inv.host} · ${inv.os.caption || inv.os.platform} ${inv.os.release} (${inv.os.arch}) · uptime ${(inv.os.uptimeSec / 3600).toFixed(1)} h`,
        `CPU: ${inv.cpu.model} · ${inv.cpu.cores} threads · uso ${inv.cpu.usagePct}%`,
        `RAM: ${mb(inv.memory.totalMb - inv.memory.freeMb)} de ${mb(inv.memory.totalMb)} (${inv.memory.usedPct}%)`,
        `Discos: ${inv.disks.map(d => `${d.mount} ${d.usedPct}% (${mb(d.freeMb)} livres de ${mb(d.totalMb)})`).join(' · ') || '—'}`,
        `GPU: ${inv.gpus.map(g => `${g.name}${g.memoryTotalMb ? ` VRAM ${mb(g.memoryUsedMb)}/${mb(g.memoryTotalMb)}` : ''}${g.temperatureC !== undefined ? ` ${g.temperatureC}°C` : ''}${g.utilizationPct !== undefined ? ` uso ${g.utilizationPct}%` : ''}${g.driver ? ` driver ${g.driver}` : ''}`).join(' · ') || 'nenhuma detectada'}`,
        `Rede: ${inv.network.filter(n => n.family === 'IPv4').map(n => `${n.name} ${n.address}`).join(' · ')}`,
        `Maiores processos (RAM): ${inv.topProcesses.slice(0, 6).map(p => `${p.name} ${mb(p.memMb)}`).join(', ')}`,
        inv.stoppedAutoServices.length ? `Serviços automáticos parados: ${inv.stoppedAutoServices.slice(0, 10).map(s => s.name).join(', ')}` : '',
        `Ferramentas presentes: ${tools}`,
        `Ausentes: ${missing} (instale com infra_install; * = não instalável via winget)`,
        inv.issues.length ? `⚠ Problemas: ${inv.issues.join('; ')}` : 'Sem problemas de recursos detectados.',
      ].filter(Boolean).join('\n') }
    }
    case 'infra_diagnose': {
      const d = await diagnose(str(a.target, 'target'))
      return { output: `Veredito: ${d.verdict.toUpperCase()}${d.probableCause ? `\nCausa provável: ${d.probableCause}` : ''}\n${d.findings.map(f => `- ${f}`).join('\n')}` }
    }
    case 'infra_ports': {
      const ports = await listeningPorts()
      return { output: ports.length ? ports.map(p => `${p.exposed ? '🌐 exposta ' : '🔒 local   '} ${p.address}:${p.port}  ${p.process} (pid ${p.pid})`).join('\n') : 'Nenhuma porta em escuta encontrada (ou sem permissão para listar).' }
    }
    case 'infra_monitor': {
      const w = getInfraCore().watchdog
      const op = String(a.op || 'list')
      if (op === 'list') {
        const list = w.list()
        return { output: list.length ? list.map(m => `${m.id} · ${m.enabled ? '' : '(desativado) '}${m.name} [${m.kind} ${m.target}] → ${m.state.status}${m.state.lastError ? ` (${m.state.lastError})` : ''}${m.recovery ? ' · autorrecuperação' : ''}${m.state.breakerOpen ? ' · RECUPERAÇÃO SUSPENSA' : ''}`).join('\n') : 'Nenhum monitor.' }
      }
      if (op === 'incidents') {
        const inc = w.listIncidents(15)
        return { output: inc.length ? inc.map(i => `${i.status === 'open' ? '🔴' : '🟢'} ${new Date(i.openedAt).toLocaleString('pt-BR')} ${i.monitorName}: ${i.cause}${i.autoRecovered ? ' (recuperado automaticamente)' : ''}`).join('\n') : 'Nenhum incidente registrado.' }
      }
      if (op === 'check') {
        const st = await w.checkNow(str(a.id, 'id'))
        return { output: `${st.status}${st.lastLatencyMs !== undefined ? ` em ${st.lastLatencyMs} ms` : ''}${st.lastError ? ` — ${st.lastError}` : ''}` }
      }
      if (op === 'add') {
        const kind = str(a.kind, 'kind') as MonitorKind
        const def = w.add({
          name: typeof a.name === 'string' ? a.name : undefined,
          kind,
          target: typeof a.target === 'string' ? a.target : '',
          intervalSec: Number(a.interval_sec) || 60,
          resource: kind === 'resource' ? { metric: str(a.metric, 'metric') as ResourceMetric, max: Number(a.max) || 90 } : undefined,
        }, actor)
        audit({ actor, action: 'monitor:add', target: `${def.name} (${def.kind} ${def.target})`, ok: true })
        const st = await w.checkNow(def.id)
        return { output: `Monitor criado (${def.id}). Primeira verificação: ${st.status}${st.lastError ? ` — ${st.lastError}` : ''}. Autorrecuperação só pode ser configurada pelo usuário no painel Infra.` }
      }
      throw new Error('op inválida')
    }
    case 'infra_servers': {
      const list = listServers()
      return { output: list.length ? list.map(s => `${s.name} → ${s.user}@${s.host}:${s.port} (${s.os})${s.lastCheck ? ` · último teste ${s.lastCheck.ok ? 'ok' : 'FALHOU'}` : ''}`).join('\n') : 'Nenhum servidor cadastrado. Peça ao usuário para cadastrar em Infra › Servidores (host, usuário e chave SSH).' }
    }
    case 'infra_ssh': {
      const server = findServer(str(a.server, 'server'))
      const command = str(a.command, 'command')
      const risk = classifyCommand(command)
      if (risk.level === 'critical') {
        const req = requestSshExec(server.id, command, actor)
        audit({ actor, action: 'ssh:pedido-aprovacao', target: server.name, risk: risk.level, ok: true, detail: command })
        return { output: `Comando CRÍTICO (${risk.reasons.join(', ')}): NÃO executado. Pedido de aprovação ${req.id} criado em Infra › Aprovações. Continue com o que não depende disso e informe o usuário.` }
      }
      const r = await execRemote(server, command)
      audit({ actor, action: 'ssh', target: server.name, risk: risk.level, ok: r.ok, detail: command, durationMs: r.durationMs })
      return { output: `[${server.name}] risco: ${RISK_LABEL[risk.level]} · exit ${r.exitCode} · ${r.durationMs} ms${r.timedOut ? ' · TEMPO ESGOTADO' : ''}\n${r.stdout.slice(-8000)}${r.stderr ? `\n[stderr]\n${r.stderr.slice(-3000)}` : ''}` }
    }
    case 'infra_server_inventory': {
      const server = findServer(str(a.server, 'server'))
      const r = await remoteInventory(server)
      audit({ actor, action: 'ssh:inventario', target: server.name, risk: 'read', ok: r.ok, durationMs: r.durationMs })
      if (!r.sections.length) return { output: `Falha ao inventariar ${server.name}: ${r.stderr}` }
      return { output: r.sections.map(s => `## ${s.title}\n${s.body}`).join('\n\n').slice(0, 12_000) }
    }
    case 'infra_docker': {
      const op = String(a.op || 'list')
      if (op === 'list') {
        const d = await dockerOverview()
        if (!d.available || !d.daemon) return { output: d.installHint || d.error || 'Docker indisponível' }
        return { output: `Docker ${d.version} · ${d.images} imagem(ns)\n${d.containers.map(c => `${c.state === 'running' ? '🟢' : '⚪'} ${c.name} (${c.image}) ${c.status}${c.cpu ? ` · CPU ${c.cpu} · RAM ${c.mem}` : ''}${c.ports ? ` · ${c.ports}` : ''}`).join('\n') || 'Nenhum container.'}` }
      }
      const container = str(a.container, 'container')
      if (op === 'logs') return { output: await dockerLogs(container, 200) }
      if (op === 'stop') {
        const req = requestDockerAction(container, 'stop', actor)
        return { output: `Parar um container derruba o serviço: pedido de aprovação ${req.id} criado em Infra › Aprovações.` }
      }
      if (op === 'start' || op === 'restart') {
        const out = await dockerAction(container, op)
        audit({ actor, action: `docker:${op}`, target: container, risk: 'change', ok: true })
        return { output: out }
      }
      throw new Error('op inválida')
    }
    case 'infra_backup': {
      const op = String(a.op || 'list')
      if (op === 'list') {
        const list = listBackups().slice(0, 15)
        return { output: list.length ? list.map(b => `${b.id} · ${new Date(b.createdAt).toLocaleString('pt-BR')} · ${b.label} · ${(b.size / 1048576).toFixed(1)} MB · ${b.entries} itens${b.encrypted ? ' · 🔒' : ''} · ${b.verifyOk === false ? 'FALHOU verificação' : 'ok'}`).join('\n') : 'Nenhum backup ainda.' }
      }
      if (op === 'create') {
        const b = await createBackup({ label: typeof a.label === 'string' ? a.label : 'Backup pedido por agente', trigger: 'agente' })
        audit({ actor, action: 'backup:create', target: b.id, ok: true })
        return { output: `Backup ${b.id} criado e verificado: ${(b.size / 1048576).toFixed(1)} MB, ${b.entries} itens, SHA-256 ${b.sha256.slice(0, 16)}…` }
      }
      if (op === 'verify') {
        const r = await verifyBackup(str(a.id, 'id'))
        return { output: r.ok && 'entries' in r ? `Backup íntegro (${r.entries} itens)` : `Backup com PROBLEMA: ${'error' in r ? r.error : 'falhou'}` }
      }
      throw new Error('op inválida')
    }
    case 'infra_selfcheck': {
      const r = selfReport()
      const icon = { ok: '✅', warn: '⚠️', fail: '❌' }
      return { output: `Saúde do JARVIS: ${icon[r.status]}\n${r.checks.map(c => `${icon[c.status]} ${c.label}: ${c.detail}`).join('\n')}` }
    }
    case 'infra_ai': {
      const [inv, ol] = await Promise.all([getInventory(), ollamaStatus()])
      const gpu = bestGpu(inv.gpus)
      const adv = recommendModels({ vramMb: gpu?.memoryTotalMb, ramMb: inv.memory.totalMb })
      return { output: [
        `GPU: ${gpu ? `${gpu.name} · VRAM ${mb(gpu.memoryTotalMb)}${gpu.memoryUsedMb !== undefined ? ` (${mb(gpu.memoryUsedMb)} em uso)` : ''}` : 'nenhuma com VRAM detectável'} · RAM ${mb(inv.memory.totalMb)}`,
        `Capacidade: ${adv.tier} — até ~${adv.maxParamsB}B parâmetros (Q4) em ${adv.where}`,
        `Sugestões: ${adv.examples.join(' | ')}`,
        ...adv.notes.map(n => `- ${n}`),
        ol.running
          ? `Ollama ${ol.version}: ${ol.models.length} modelo(s) instalado(s): ${ol.models.map(m => `${m.name} (${mb(m.sizeMb)})`).join(', ') || '—'}${ol.loaded.length ? ` · carregados: ${ol.loaded.map(l => `${l.name} ${mb(l.vramMb)} VRAM`).join(', ')}` : ''}`
          : `Ollama: ${ol.error}`,
      ].join('\n') }
    }
    case 'infra_install': {
      const req = requestInstall(str(a.tool, 'tool'), actor)
      return { output: `Pedido ${req.id} criado: "${req.title}" (${req.command}). O usuário aprova em Infra › Aprovações; continue com o que não depende disso.` }
    }
    case 'infra_request': {
      const command = str(a.command, 'command')
      const req = requestLocalExec(command, actor)
      audit({ actor, action: 'local:pedido-aprovacao', risk: req.risk, ok: true, detail: `${command} — ${typeof a.reason === 'string' ? a.reason : ''}` })
      return { output: `Pedido ${req.id} criado (${RISK_LABEL[req.risk]}). Nada foi executado; o usuário decide em Infra › Aprovações.` }
    }
    default:
      throw new Error(`Ferramenta desconhecida: ${action.tool}`)
  }
}

export const isInfraTool = (name: string) => INFRA_TOOL_SPECS.some(t => t.name === name)
