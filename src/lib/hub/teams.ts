import { connections, getSecret, setSecret } from './store'
import type { HubItem } from './types'

const GRAPH = 'https://graph.microsoft.com/v1.0'
// Permissions a student can usually grant alone (no admin consent)
const BASE_SCOPES = ['offline_access', 'User.Read', 'Team.ReadBasic.All', 'Channel.ReadBasic.All', 'Chat.Read', 'ChatMessage.Send', 'Calendars.Read', 'Files.Read.All', 'EduAssignments.ReadBasic']
// Reading/posting channel messages needs the school's admin consent in most tenants
const CHANNEL_SCOPES = ['ChannelMessage.Read.All', 'ChannelMessage.Send']

interface TeamsTokens { access_token: string; refresh_token?: string; expires_at: number; scope?: string }
interface DeviceFlow { user_code: string; verification_uri: string; message: string; expires_at: number; status: 'pending' | 'done' | 'error'; error?: string }

const g = globalThis as unknown as { __jarvisTeamsFlow?: DeviceFlow }

function cfg() {
  const c = connections.get('teams')?.config || {}
  const clientId = String(c.clientId || '')
  if (!/^[0-9a-f-]{36}$/i.test(clientId)) throw new Error('Informe o "ID do aplicativo (cliente)" do seu registro no Azure (veja as instruções na conexão do Teams)')
  return { clientId, tenant: String(c.tenant || 'organizations'), channels: c.channelScopes === true }
}

function scopes() {
  return [...BASE_SCOPES, ...(cfg().channels ? CHANNEL_SCOPES : [])].join(' ')
}

function explainAadError(code: string, desc: string) {
  if (/AADSTS65001|AADSTS90094|consent|admin/i.test(desc)) return 'A faculdade exige aprovação do administrador para esse aplicativo/permissão. Peça ao suporte de TI ou desative “permissões de canais”.'
  if (/AADSTS700016/i.test(desc)) return 'ID do aplicativo não encontrado nesse diretório. Confira o ID e se o registro aceita “contas em qualquer diretório organizacional”.'
  if (/AADSTS7000218|public client/i.test(desc)) return 'Ative “Permitir fluxos de cliente público” em Autenticação no registro do aplicativo.'
  return `${code}: ${desc.split('\r\n')[0].slice(0, 300)}`
}

async function tokenRequest(body: Record<string, string>) {
  const { tenant } = cfg()
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(body), signal: AbortSignal.timeout(20_000),
  })
  const d = await res.json() as Record<string, string>
  return { ok: res.ok, d }
}

/** Starts Microsoft's device-code sign-in. The user signs in on Microsoft's own page; JARVIS never sees the password. */
export async function startTeamsLogin() {
  const { clientId, tenant } = cfg()
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/devicecode`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: clientId, scope: scopes() }), signal: AbortSignal.timeout(20_000),
  })
  const d = await res.json() as Record<string, string | number>
  if (!res.ok) throw new Error(explainAadError(String(d.error), String(d.error_description || '')))
  const flow: DeviceFlow = { user_code: String(d.user_code), verification_uri: String(d.verification_uri), message: String(d.message), expires_at: Date.now() + Number(d.expires_in) * 1000, status: 'pending' }
  g.__jarvisTeamsFlow = flow
  void pollDeviceCode(String(d.device_code), Number(d.interval || 5))
  return flow
}

async function pollDeviceCode(deviceCode: string, interval: number) {
  const flow = g.__jarvisTeamsFlow!
  const { clientId } = cfg()
  while (Date.now() < flow.expires_at && flow.status === 'pending') {
    await new Promise(r => setTimeout(r, interval * 1000))
    const { ok, d } = await tokenRequest({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: clientId, device_code: deviceCode }).catch(() => ({ ok: false, d: { error: 'network' } as Record<string, string> }))
    if (ok) {
      setSecret('teams', { access_token: d.access_token, refresh_token: d.refresh_token, expires_at: Date.now() + Number(d.expires_in) * 1000 - 60_000, scope: d.scope } satisfies TeamsTokens)
      flow.status = 'done'
      const conn = connections.get('teams')
      if (conn) connections.upsert({ ...conn, status: 'connected', lastError: undefined })
      return
    }
    if (d.error === 'authorization_pending' || d.error === 'network') continue
    if (d.error === 'slow_down') { interval += 5; continue }
    flow.status = 'error'
    flow.error = explainAadError(d.error, d.error_description || '')
    return
  }
  if (flow.status === 'pending') { flow.status = 'error'; flow.error = 'O código expirou. Tente conectar de novo.' }
}

export function teamsLoginStatus() {
  return g.__jarvisTeamsFlow
}

async function accessToken(): Promise<string> {
  const t = getSecret<TeamsTokens>('teams')
  if (!t) throw Object.assign(new Error('Entre com sua conta Microsoft para conectar o Teams'), { needsAuth: true })
  if (t.expires_at > Date.now()) return t.access_token
  if (!t.refresh_token) throw Object.assign(new Error('Sessão expirada; entre novamente'), { needsAuth: true })
  const { ok, d } = await tokenRequest({ grant_type: 'refresh_token', client_id: cfg().clientId, refresh_token: t.refresh_token, scope: scopes() })
  if (!ok) throw Object.assign(new Error(explainAadError(d.error, d.error_description || '')), { needsAuth: true })
  setSecret('teams', { access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, expires_at: Date.now() + Number(d.expires_in) * 1000 - 60_000, scope: d.scope })
  return d.access_token
}

export async function graph<T>(pathOrUrl: string, init: RequestInit = {}): Promise<T> {
  const token = await accessToken()
  const url = pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH}${pathOrUrl}`
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> || {}) }, signal: AbortSignal.timeout(30_000) })
  if (!res.ok) {
    let msg = res.statusText
    try { msg = ((await res.json()) as { error?: { message?: string } }).error?.message || msg } catch {}
    const hint = res.status === 403 ? ' (sem permissão — pode exigir aprovação do administrador da faculdade)' : ''
    throw Object.assign(new Error(`Graph ${res.status}: ${msg}${hint}`), { status: res.status })
  }
  return (res.status === 204 ? {} : await res.json()) as T
}

const html = (s?: string) => (s || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim()

interface GMessage { id: string; createdDateTime: string; from?: { user?: { displayName?: string } }; body?: { content?: string }; subject?: string | null; attachments?: Array<{ name?: string; contentUrl?: string }>; webUrl?: string; messageType?: string }

function messageItem(m: GMessage, where: string, extra: Record<string, unknown>): HubItem | null {
  if (m.messageType && m.messageType !== 'message') return null
  const text = html(m.body?.content)
  if (!text && !m.attachments?.length) return null
  return {
    id: `teams-msg-${m.id}`,
    source: 'teams',
    kind: 'message',
    title: m.subject || `${m.from?.user?.displayName || 'Mensagem'} em ${where}`,
    text: `${m.subject ? `${m.subject}\n` : ''}${text}`.slice(0, 8000),
    origin: { source: 'teams', where, author: m.from?.user?.displayName, at: Date.parse(m.createdDateTime), url: m.webUrl, ref: m.id },
    attachments: (m.attachments || []).filter(a => a.name).map(a => ({ name: a.name!, url: a.contentUrl })),
    meta: extra,
    importedAt: Date.now(),
  }
}

/** Reads everything the granted permissions allow; each part fails independently with a clear reason. */
export async function syncTeams(): Promise<{ items: HubItem[]; account: string; errors: string[]; teams: string[] }> {
  const me = await graph<{ displayName: string; userPrincipalName: string }>('/me')
  const items: HubItem[] = []
  const errors: string[] = []
  const teamNames: string[] = []
  const part = async (label: string, fn: () => Promise<void>) => { try { await fn() } catch (e) { errors.push(`${label}: ${(e as Error).message}`) } }

  await part('Equipes e canais', async () => {
    const teams = await graph<{ value: Array<{ id: string; displayName: string; description?: string }> }>('/me/joinedTeams')
    for (const t of teams.value.slice(0, 25)) {
      teamNames.push(t.displayName)
      items.push({ id: `teams-team-${t.id}`, source: 'teams', kind: 'course', title: t.displayName, text: `${t.displayName}\n${t.description || ''}`, origin: { source: 'teams', where: t.displayName, ref: t.id }, meta: { teamId: t.id }, importedAt: Date.now() })
      const channels = await graph<{ value: Array<{ id: string; displayName: string }> }>(`/teams/${t.id}/channels`)
      if (!cfg().channels) continue
      for (const c of channels.value.slice(0, 10)) {
        await part(`Mensagens de ${t.displayName} › ${c.displayName}`, async () => {
          const msgs = await graph<{ value: GMessage[] }>(`/teams/${t.id}/channels/${c.id}/messages?$top=40`)
          for (const m of msgs.value) {
            const it = messageItem(m, `${t.displayName} › ${c.displayName}`, { teamId: t.id, channelId: c.id, messageId: m.id })
            if (it) items.push({ ...it, kind: 'announcement' })
          }
        })
      }
    }
  })

  await part('Chats', async () => {
    const chats = await graph<{ value: Array<{ id: string; topic?: string | null; chatType: string }> }>('/me/chats?$top=40')
    for (const c of chats.value) {
      const where = c.topic || (c.chatType === 'oneOnOne' ? 'Chat individual' : 'Chat em grupo')
      await part(`Chat ${where}`, async () => {
        const msgs = await graph<{ value: GMessage[] }>(`/me/chats/${c.id}/messages?$top=40`)
        for (const m of msgs.value) {
          const it = messageItem(m, `Teams › ${where}`, { chatId: c.id, messageId: m.id })
          if (it) items.push(it)
        }
      })
    }
  })

  await part('Tarefas do Teams (Education)', async () => {
    const res = await graph<{ value: Array<{ id: string; displayName: string; dueDateTime?: string; instructions?: { content?: string }; classId?: string; status?: string; webUrl?: string }> }>('/education/me/assignments')
    for (const a of res.value) {
      items.push({
        id: `teams-assign-${a.id}`, source: 'teams', kind: 'assignment', title: a.displayName,
        text: `${a.displayName}\n${html(a.instructions?.content)}`.slice(0, 8000),
        origin: { source: 'teams', where: 'Teams › Tarefas', at: a.dueDateTime ? Date.parse(a.dueDateTime) : undefined, url: a.webUrl, ref: a.id },
        meta: { due: a.dueDateTime ? Date.parse(a.dueDateTime) : undefined, classId: a.classId, status: a.status },
        importedAt: Date.now(),
      })
    }
  })

  await part('Reuniões e aulas', async () => {
    const start = new Date(Date.now() - 7 * 86400_000).toISOString()
    const end = new Date(Date.now() + 45 * 86400_000).toISOString()
    const ev = await graph<{ value: Array<{ id: string; subject: string; start: { dateTime: string; timeZone: string }; bodyPreview?: string; webLink?: string; onlineMeeting?: { joinUrl?: string } }> }>(`/me/calendarView?startDateTime=${start}&endDateTime=${end}&$top=100`)
    for (const e of ev.value) {
      const at = Date.parse(e.start.dateTime + (e.start.timeZone === 'UTC' ? 'Z' : ''))
      items.push({ id: `teams-event-${e.id}`, source: 'teams', kind: 'event', title: e.subject, text: `${e.subject}\n${e.bodyPreview || ''}`, origin: { source: 'teams', where: 'Calendário Microsoft', at, url: e.onlineMeeting?.joinUrl || e.webLink, ref: e.id }, meta: { start: at }, importedAt: Date.now() })
    }
  })

  await part('Arquivos recentes', async () => {
    const files = await graph<{ value: Array<{ id: string; name: string; webUrl: string; lastModifiedDateTime: string; remoteItem?: { parentReference?: { driveId?: string } } }> }>('/me/drive/recent?$top=50')
    for (const f of files.value) {
      items.push({ id: `teams-file-${f.id}`, source: 'teams', kind: 'file', title: f.name, text: f.name, origin: { source: 'teams', where: 'OneDrive/Teams › arquivos recentes', at: Date.parse(f.lastModifiedDateTime), url: f.webUrl, ref: f.id }, attachments: [{ name: f.name, url: f.webUrl }], importedAt: Date.now() })
    }
  })

  return { items, account: `${me.displayName} (${me.userPrincipalName})`, errors, teams: teamNames }
}

/** Only called after the user approved the message. */
export async function sendTeamsMessage(payload: { chatId?: string; teamId?: string; channelId?: string; replyTo?: string; text: string }) {
  const body = JSON.stringify({ body: { contentType: 'text', content: payload.text } })
  if (payload.chatId) { await graph(`/chats/${payload.chatId}/messages`, { method: 'POST', body }); return 'Mensagem enviada no chat do Teams' }
  if (payload.teamId && payload.channelId && payload.replyTo) { await graph(`/teams/${payload.teamId}/channels/${payload.channelId}/messages/${payload.replyTo}/replies`, { method: 'POST', body }); return 'Resposta publicada no canal' }
  if (payload.teamId && payload.channelId) { await graph(`/teams/${payload.teamId}/channels/${payload.channelId}/messages`, { method: 'POST', body }); return 'Mensagem publicada no canal' }
  throw new Error('Destino da mensagem do Teams não informado')
}
