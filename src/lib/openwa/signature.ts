/**
 * JARVIS — Verificação da assinatura dos webhooks do OpenWA.
 * Header X-OpenWA-Signature: sha256=<hex> — HMAC-SHA256 do corpo bruto com o segredo.
 */
import crypto from 'crypto'

export function verifyOpenwaSignature(rawBody: string, signatureHeader: string | null | undefined, secret: string): boolean {
  if (!secret) return false
  const header = String(signatureHeader || '').trim()
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header)
  if (!m) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest()
  let provided: Buffer
  try { provided = Buffer.from(m[1].toLowerCase(), 'hex') } catch { return false }
  return expected.length === provided.length && crypto.timingSafeEqual(expected, provided)
}
