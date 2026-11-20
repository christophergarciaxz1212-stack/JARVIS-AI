// Secret redaction (logs, prompts and tool outputs never carry credentials).

const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASS|AUTH|CREDENTIAL|COOKIE/i

export function redact(text: string): string {
  if (!text) return text
  let out = String(text)
  for (const [name, value] of Object.entries(process.env)) {
    if (!value || value.length < 8 || !SECRET_NAME.test(name)) continue
    out = out.split(value).join(`***${name}***`)
  }
  return out
    .replace(/\b(gsk_|sk-|sk-ant-|ghp_|github_pat_|AIza|nvapi-|hf_|xai-)[A-Za-z0-9_\-]{10,}/g, '***')
    .replace(/(authorization:\s*bearer\s+)[^\s"']+/gi, '$1***')
    .replace(/\b(api[_-]?key|token|secret|password)\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{8,}["']?/gi, '$1=***')
}

/** Deep-redact every string value in a plain object/array (event payloads, tool args, output chunks). */
export function deepRedact<T>(value: T, depth = 0): T {
  if (value == null || depth > 6) return value
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return value.map(v => deepRedact(v, depth + 1)) as T
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      // Object keys named like secrets are redacted whole
      out[k] = SECRET_NAME.test(k) && typeof v === 'string' ? '***' : deepRedact(v, depth + 1)
    }
    return out as T
  }
  return value
}
