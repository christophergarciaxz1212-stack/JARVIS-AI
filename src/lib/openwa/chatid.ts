/**
 * Normaliza destinatário para o OpenWA:
 *  "5511998877665", "+55 (11) 99887-7665" → "5511998877665@c.us"; com @ mantém como veio (user@c.us / grupo@g.us).
 *  Retorna null se não reconhecer.
 */
export function normalizeChatId(input: string): string | null {
  const s = String(input || '').trim()
  if (!s) return null
  if (s.includes('@')) return /^[\w.:-]{1,64}@[\w.:-]{1,64}$/.test(s) ? s : null
  const digits = s.replace(/\D/g, '')
  if (digits.length < 8 || digits.length > 15) return null
  return `${digits}@c.us`
}
