import { NextRequest } from 'next/server'
import { startInfraCore, selfReport, applyFix, approveAndRun, rejectApproval, requestInstall, backupStatus } from '@/lib/infra/core'
import { getInventory } from '@/lib/infra/inventory'
import { diagnose, dnsCheck, listeningPorts, parseTarget, ping, tcpCheck, traceroute } from '@/lib/infra/netdiag'
import { ollamaStatus, recommendModels, bestGpu } from '@/lib/infra/ai'
import { dockerAction, dockerLogs, dockerOverview, type DockerAction } from '@/lib/infra/docker'
import { createBackup, deleteBackup, listBackups, restoreBackup, verifyBackup, type BackupProfile } from '@/lib/infra/backup'
import { ensureJarvisKey, execRemote, findServer, listServers, remoteInventory, removeServer, saveServer, testServer } from '@/lib/infra/ssh'
import { listApprovals } from '@/lib/infra/approvals'
import { audit, readAudit, readLogs, type LogLevel } from '@/lib/infra/log'
import { loadSettings, saveSettings } from '@/lib/infra/monitor'
import { classifyCommand } from '@/lib/infra/risk'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function fail(e: unknown, status = 400) {
  const err = e as Error & { needsConfirmation?: boolean; risk?: unknown }
  return Response.json({ error: err?.message || String(e), needsConfirmation: err?.needsConfirmation, risk: err?.risk }, { status })
}

const str = (v: unknown) => (typeof v === 'string' ? v : '')

export async function GET(req: NextRequest) {
  const core = startInfraCore()
  const w = core.watchdog
  const q = new URL(req.url).searchParams
  try {
    switch (q.get('action') || 'overview') {
      case 'alerts': {
        const open = w.openIncidents()
        return Response.json({
          open: open.length,
          unacknowledged: open.filter(i => !i.acknowledged).map(i => ({ id: i.id, monitorName: i.monitorName, cause: i.cause, openedAt: i.openedAt })),
          approvals: listApprovals().filter(a => a.status === 'pending').length,
        })
      }
      case 'overview': {
        // Inventory is fetched separately (it is the slow part) so the panel opens instantly
        return Response.json({
          monitors: w.list(),
          incidents: w.listIncidents(30),
          approvals: listApprovals().filter(a => a.status === 'pending'),
          backup: backupStatus(),
          watchdog: w.running,
          leader: !w.follower,
        })
      }
      case 'inventory': return Response.json({ inventory: await getInventory(q.get('fresh') ? 0 : 20_000) })
      case 'monitors': return Response.json({ monitors: w.list(), watchdog: w.running })
      case 'incidents': return Response.json({ incidents: w.listIncidents(Number(q.get('limit')) || 100) })
      case 'servers': return Response.json({ servers: listServers() })
      case 'docker': return Response.json({ docker: await dockerOverview() })
      case 'ports': return Response.json({ ports: await listeningPorts() })
      case 'ai': {
        const [inv, ollama] = await Promise.all([getInventory(), ollamaStatus()])
        const gpu = bestGpu(inv.gpus)
        return Response.json({ gpus: inv.gpus, ramMb: inv.memory.totalMb, ollama, advice: recommendModels({ vramMb: gpu?.memoryTotalMb, ramMb: inv.memory.totalMb }) })
      }
      case 'backups': return Response.json({ backups: listBackups(), settings: loadSettings() })
      case 'selfcheck': return Response.json({ report: selfReport() })
      case 'approvals': return Response.json({ approvals: listApprovals().slice().reverse() })
      case 'audit': return Response.json({ audit: readAudit(Number(q.get('limit')) || 200) })
      case 'logs': return Response.json({ logs: readLogs({ level: (q.get('level') || undefined) as LogLevel | undefined, area: q.get('area') || undefined, limit: Number(q.get('limit')) || 200 }) })
      case 'settings': return Response.json({ settings: loadSettings() })
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e, 500)
  }
}

export async function POST(req: NextRequest) {
  const core = startInfraCore()
  const w = core.watchdog
  let body: Record<string, unknown>
  try { body = await req.json() } catch { return fail('JSON inválido') }
  const action = str(body.action)
  const id = str(body.id)
  try {
    switch (action) {
      case 'monitor-add': {
        const def = w.add(body.monitor as never, 'user')
        audit({ actor: 'user', action: 'monitor:add', target: `${def.name} (${def.kind} ${def.target})`, ok: true, detail: def.recovery?.command })
        await w.checkNow(def.id)
        return Response.json({ monitor: def })
      }
      case 'monitor-update': {
        const def = w.update(id, body.monitor as never, 'user')
        audit({ actor: 'user', action: 'monitor:update', target: def.name, ok: true, detail: def.recovery?.command })
        return Response.json({ monitor: def })
      }
      case 'monitor-remove': w.remove(id); audit({ actor: 'user', action: 'monitor:remove', target: id, ok: true }); return Response.json({ ok: true })
      case 'monitor-check': return Response.json({ state: await w.checkNow(id) })
      case 'monitor-reset': w.resetBreaker(id); audit({ actor: 'user', action: 'monitor:reset-breaker', target: id, ok: true }); return Response.json({ ok: true })
      case 'incident-ack': w.acknowledge(id); return Response.json({ ok: true })

      case 'server-save': {
        const s = saveServer(body.server as never)
        audit({ actor: 'user', action: 'server:save', target: `${s.name} (${s.user}@${s.host}:${s.port})`, ok: true })
        return Response.json({ server: s })
      }
      case 'server-remove': removeServer(id); audit({ actor: 'user', action: 'server:remove', target: id, ok: true }); return Response.json({ ok: true })
      case 'server-test': return Response.json({ result: await testServer(findServer(id)) })
      case 'server-inventory': return Response.json({ result: await remoteInventory(findServer(id)) })
      case 'server-risk': return Response.json({ risk: classifyCommand(str(body.command)) })
      case 'server-exec': {
        const server = findServer(id)
        const command = str(body.command)
        const r = await execRemote(server, command, { confirmed: body.confirmed === true })
        audit({ actor: 'user', action: 'ssh', target: server.name, risk: r.risk.level, ok: r.ok, detail: command, durationMs: r.durationMs })
        return Response.json({ result: r })
      }
      case 'ssh-key': return Response.json({ key: await ensureJarvisKey() })

      case 'docker-logs': return Response.json({ logs: await dockerLogs(str(body.container), Number(body.tail) || 300) })
      case 'docker-action': {
        const out = await dockerAction(str(body.container), str(body.op) as DockerAction)
        audit({ actor: 'user', action: `docker:${str(body.op)}`, target: str(body.container), risk: 'change', ok: true })
        return Response.json({ message: out })
      }

      case 'diagnose': return Response.json({ diagnosis: await diagnose(str(body.target)) })
      case 'traceroute': return Response.json({ trace: await traceroute(str(body.host)) })
      case 'ping': return Response.json({ ping: await ping(parseTarget(str(body.target)).host, Number(body.count) || 4) })
      case 'dns': {
        const host = parseTarget(str(body.target)).host
        return Response.json({ dns: { host, ...(await dnsCheck(host)) } })
      }
      case 'port': {
        const t = parseTarget(str(body.target))
        const port = Number(body.port) || t.port
        if (!port || port < 1 || port > 65535) return Response.json({ error: 'Informe a porta (ex.: site.com:443 ou o campo porta)' }, { status: 400 })
        return Response.json({ tcp: await tcpCheck(t.host, port, 5000) })
      }

      case 'backup-create': {
        const s = loadSettings()
        const b = await createBackup({ label: str(body.label) || undefined, passphrase: str(body.passphrase) || undefined, profile: (str(body.profile) || s.backupProfile) as BackupProfile, keep: s.backupKeep, trigger: 'manual' })
        saveSettings({ lastBackupAt: b.createdAt })
        audit({ actor: 'user', action: 'backup:create', target: b.id, ok: true, detail: `${b.profile}${b.encrypted ? ', criptografado' : ''}` })
        return Response.json({ backup: b })
      }
      case 'backup-verify': return Response.json({ result: await verifyBackup(id, str(body.passphrase) || undefined) })
      case 'backup-restore': {
        const r = await restoreBackup(id, str(body.passphrase) || undefined)
        audit({ actor: 'user', action: 'backup:restore', target: id, ok: true, detail: r.path })
        return Response.json({ result: r })
      }
      case 'backup-delete': deleteBackup(id); audit({ actor: 'user', action: 'backup:delete', target: id, ok: true }); return Response.json({ ok: true })
      case 'settings-save': {
        const patch = body.settings as Record<string, unknown>
        const next = saveSettings({ backupEveryHours: patch?.backupEveryHours as number, backupKeep: patch?.backupKeep as number, backupProfile: patch?.backupProfile === 'completo' ? 'completo' : 'essencial' })
        audit({ actor: 'user', action: 'settings', ok: true, detail: JSON.stringify(next) })
        return Response.json({ settings: next })
      }

      case 'fix': return Response.json({ message: await applyFix({ action: str(body.fix) as never, arg: str(body.arg) || undefined }) })
      case 'approve': return Response.json({ approval: await approveAndRun(id) })
      case 'reject': return Response.json({ approval: rejectApproval(id) })
      case 'install': {
        // The user clicked "Instalar" themselves: the request is created and approved in one step
        const a = requestInstall(str(body.tool), 'user')
        return Response.json({ approval: await approveAndRun(a.id) })
      }
      default: return fail('Ação inválida', 404)
    }
  } catch (e) {
    return fail(e)
  }
}
