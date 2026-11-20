export type MetaConfig = {
  // non-secret operational config
  appId?: string
  apiVersion: string
  verifyToken?: string
  redirectUri?: string
  connected: boolean
  connectedAt?: number
  wabaId?: string
  phoneNumberId?: string
  businessId?: string
  displayPhoneNumber?: string
  verifiedName?: string
  scopes?: string[]
  tokenExpiresAt?: number
  lastError?: string
  webhookVerified?: boolean
  lastWebhookAt?: number
  // automation prefs
  autoReplyEnabled?: boolean
}

export type MetaSecrets = {
  appSecret?: string
  userAccessToken?: string
  // optional override for webhook signature secret (defaults to appSecret)
  webhookSecret?: string
}

export type WaContact = {
  id: string // phone number (digits) or wa_id
  waId: string
  name?: string
  phone?: string
  category?: string
  tags?: string[]
  notes?: string
  important?: boolean
  client?: boolean
  lastMessageAt?: number
  unread?: number
  createdAt: number
  updatedAt: number
}

export type WaMessageDirection = 'inbound' | 'outbound'
export type WaMessageStatus = 'pending' | 'sent' | 'delivered' | 'read' | 'failed'
export type WaMessageType =
  | 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker'
  | 'location' | 'contacts' | 'interactive' | 'reaction' | 'template' | 'unknown'

export type WaMedia = {
  id: string
  mimeType?: string
  sha256?: string
  filename?: string
  size?: number
  url?: string // local cached path or remote
  caption?: string
}

export type WaLocation = { latitude: number; longitude: number; name?: string; address?: string }

export type WaMessage = {
  id: string // Meta message id
  conversationId: string // phone number (wa_id) of the other party (or group id)
  direction: WaMessageDirection
  from: string
  to: string
  type: WaMessageType
  text?: string
  media?: WaMedia
  location?: WaLocation
  timestamp: number // ms
  status: WaMessageStatus
  statusUpdatedAt?: number
  quotedMessageId?: string
  contactName?: string
  raw?: unknown
  duplicate?: boolean
}

export type WaConversation = {
  id: string // wa_id of other party
  contactId?: string
  name?: string
  phone?: string
  lastMessageAt: number
  lastMessagePreview?: string
  lastDirection?: WaMessageDirection
  unread: number
  important?: boolean
  category?: string
  tags?: string[]
  notes?: string
  messages: string[] // message ids
}

export type WaAutomation = {
  id: string
  name: string
  enabled: boolean
  trigger: {
    type: 'keyword' | 'contact' | 'any' | 'question' | 'document' | 'outside_hours'
    keyword?: string
    contactPhone?: string
    outsideHoursStart?: string // "22:00"
    outsideHoursEnd?: string // "08:00"
  }
  action: {
    type: 'notify' | 'classify' | 'suggest_reply' | 'auto_reply' | 'create_reminder' | 'organize_file'
    template?: string
    category?: string
    replyText?: string
  }
  createdAt: number
  updatedAt: number
}

export type WaNotification = {
  id: string
  messageId: string
  conversationId: string
  contactName?: string
  phone?: string
  preview: string
  timestamp: number
  read: boolean
}

export type WebhookEvent = {
  id: string
  receivedAt: number
  type: string
  payload: unknown
  processed: boolean
  error?: string
}