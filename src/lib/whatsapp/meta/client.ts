import { readConfig, readSecrets } from './store'

const GRAPH = 'https://graph.facebook.com'

function apiVersion() { return readConfig().apiVersion || 'v20.0' }
function baseUrl() { return `${GRAPH}/${apiVersion()}` }

function token(): string {
  const t = readSecrets().userAccessToken
  if (!t) throw new Error('Token de acesso Meta ausente — conecte o WhatsApp primeiro')
  return t
}

async function graphFetch(path: string, init?: RequestInit): Promise<any> {
  const url = path.startsWith('http') ? path : `${baseUrl()}${path}`
  const headers = new Headers(init?.headers || {})
  if (!headers.has('Authorization')) headers.set('Authorization', `Bearer ${token()}`)
  const res = await fetch(url, { ...init, headers })
  const text = await res.text()
  let data: any
  try { data = text ? JSON.parse(text) : {} } catch { data = { raw: text } }
  if (!res.ok) {
    const msg = data?.error?.message || data?.error?.error_user_msg || `HTTP ${res.status}`
    throw new Error(`Meta API: ${msg}`)
  }
  return data
}

export async function exchangeCodeForToken(code: string, redirectUri: string, appId: string, appSecret: string): Promise<{ accessToken: string; expiresIn?: number }> {
  const url = `${GRAPH}/oauth/access_token?client_id=${encodeURIComponent(appId)}&client_secret=${encodeURIComponent(appSecret)}&redirect_uri=${encodeURIComponent(redirectUri)}&code=${encodeURIComponent(code)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok || !data.access_token) throw new Error(data?.error?.message || 'Falha ao trocar code por token')
  return { accessToken: data.access_token, expiresIn: data.expires_in }
}

export async function debugToken(accessToken: string, appId: string, appSecret: string): Promise<any> {
  const url = `${GRAPH}/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(appId + '|' + appSecret)}`
  const res = await fetch(url)
  const data = await res.json()
  if (!res.ok) throw new Error(data?.error?.message || 'Falha ao validar token')
  return data
}

export async function listWhatsAppBusinessAccounts(): Promise<Array<{ id: string; name: string }>> {
  const data = await graphFetch('/me/whatsapp_business_accounts?fields=id,name')
  return Array.isArray(data?.data) ? data.data : []
}

export async function listPhoneNumbers(wabaId: string): Promise<Array<{ id: string; display_phone_number?: string; verified_name?: string; quality_rating?: string }>> {
  const data = await graphFetch(`/${wabaId}/phone_numbers?fields=id,display_phone_number,verified_name,quality_rating`)
  return Array.isArray(data?.data) ? data.data : []
}

export async function sendText(phoneNumberId: string, to: string, body: string, quotedMessageId?: string): Promise<any> {
  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { body, preview_url: false },
  }
  if (quotedMessageId) payload.context = { message_id: quotedMessageId }
  return graphFetch(`/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function uploadMedia(phoneNumberId: string, filePath: string, mimeType: string): Promise<string> {
  // multipart upload
  const fs = await import('fs')
  const { Blob } = await import('buffer')
  const buf = fs.readFileSync(filePath)
  const blob = new Blob([buf as any], { type: mimeType }) as any
  const form = new FormData()
  form.append('messaging_product', 'whatsapp')
  form.append('file', blob, filePath.split(/[\\/]/).pop() || 'file')
  form.append('type', mimeType)
  const res = await fetch(`${baseUrl()}/${phoneNumberId}/media`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token()}` },
    body: form,
  })
  const data = await res.json()
  if (!res.ok || !data.id) throw new Error(data?.error?.message || 'Falha no upload de mídia')
  return data.id
}

export async function sendMedia(phoneNumberId: string, to: string, mediaId: string, type: 'image' | 'audio' | 'video' | 'document', caption?: string, filename?: string): Promise<any> {
  const obj: any = { id: mediaId }
  if (caption) obj.caption = caption
  if (filename && type === 'document') obj.filename = filename
  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type,
    [type]: obj,
  }
  return graphFetch(`/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function sendLocation(phoneNumberId: string, to: string, lat: number, lng: number, name?: string, address?: string): Promise<any> {
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'location',
    location: { latitude: lat, longitude: lng, name, address },
  }
  return graphFetch(`/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function sendTemplate(phoneNumberId: string, to: string, templateName: string, languageCode: string, components?: any[]): Promise<any> {
  const payload: any = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'template',
    template: { name: templateName, language: { code: languageCode }, components },
  }
  return graphFetch(`/${phoneNumberId}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

export async function getMediaUrl(mediaId: string): Promise<{ url: string; mimeType?: string; sha256?: string; fileSize?: number }> {
  const data = await graphFetch(`/${mediaId}?fields=url,mime_type,sha256,file_size`)
  return { url: data.url, mimeType: data.mime_type, sha256: data.sha256, fileSize: data.file_size }
}

export async function downloadMedia(mediaId: string): Promise<{ buffer: Buffer; mimeType?: string }> {
  const info = await getMediaUrl(mediaId)
  const res = await fetch(info.url, { headers: { Authorization: `Bearer ${token()}` } })
  if (!res.ok) throw new Error(`Falha ao baixar mídia: HTTP ${res.status}`)
  const ab = await res.arrayBuffer()
  return { buffer: Buffer.from(ab), mimeType: info.mimeType }
}

export async function getBusinessProfile(phoneNumberId: string): Promise<any> {
  return graphFetch(`/${phoneNumberId}?fields=verified_name,display_phone_number,quality_rating`)
}

export async function subscribeAppToWaba(wabaId: string): Promise<any> {
  // subscribe app to webhook events for this WABA
  return graphFetch(`/${wabaId}/subscribed_apps`, { method: 'POST' })
}