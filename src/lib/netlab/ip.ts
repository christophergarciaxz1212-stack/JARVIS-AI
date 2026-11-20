/** IPv4 helpers for addressing plans (pure functions, used on server and client). */

export interface Cidr { ip: number; prefix: number; network: number; broadcast: number; text: string }

export function ipToInt(ip: string): number | null {
  const m = ip.trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)
  if (!m) return null
  const parts = m.slice(1).map(Number)
  if (parts.some(p => p > 255)) return null
  return ((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]
}

export const intToIp = (n: number) => [n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join('.')

export function maskOf(prefix: number) {
  return prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
}

export function parseCidr(text: string | undefined): Cidr | null {
  if (!text) return null
  const m = text.trim().match(/^([\d.]+)\/(\d{1,2})$/)
  if (!m) return null
  const ip = ipToInt(m[1])
  const prefix = Number(m[2])
  if (ip === null || prefix > 32) return null
  const network = (ip & maskOf(prefix)) >>> 0
  const broadcast = (network | (~maskOf(prefix) >>> 0)) >>> 0
  return { ip, prefix, network, broadcast, text: `${m[1]}/${prefix}` }
}

export const maskText = (prefix: number) => intToIp(maskOf(prefix))
export const networkText = (c: Cidr) => `${intToIp(c.network)}/${c.prefix}`

/** Host address that is neither the network nor the broadcast (point-to-point /31 and /32 are fine). */
export function isHostAddress(c: Cidr) {
  if (c.prefix >= 31) return true
  return c.ip !== c.network && c.ip !== c.broadcast
}

export function sameSubnet(a: Cidr, b: Cidr) {
  return a.prefix === b.prefix && a.network === b.network
}

export function overlaps(a: Cidr, b: Cidr) {
  return a.network <= b.broadcast && b.network <= a.broadcast
}

export function isPrivate(ipInt: number) {
  const a = ipInt >>> 24, b = (ipInt >>> 16) & 255
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
}
