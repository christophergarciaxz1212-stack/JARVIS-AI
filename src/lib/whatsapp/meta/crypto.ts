import crypto from 'crypto'

export function verifyWebhookSignature(rawBody: string | Buffer, signatureHeader: string | null, secret: string): boolean {
  if (!signatureHeader || !secret) return false
  const parts = signatureHeader.split('=')
  if (parts.length !== 2 || parts[0] !== 'sha256') return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  const provided = parts[1]
  try {
    return crypto.timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'))
  } catch {
    return false
  }
}

export function randomToken(len = 32): string {
  return crypto.randomBytes(len).toString('hex')
}