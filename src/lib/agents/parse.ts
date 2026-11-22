// Models wrap JSON in prose or code fences, or truncate it. Extract the first balanced object.

export function extractJson(text: string): unknown {
  const cleaned = text.replace(/<think>[\s\S]*?<\/think>/gi, '').trim()
  const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidates = fenced ? [fenced[1], cleaned] : [cleaned]

  for (const c of candidates) {
    const start = c.indexOf('{')
    if (start < 0) continue
    const obj = balancedObject(c, start)
    if (obj) {
      try { return JSON.parse(obj) } catch {}
      try { return JSON.parse(repair(obj)) } catch {}
    }
  }
  throw new Error('A resposta não contém um JSON válido')
}

function balancedObject(s: string, start: number): string | null {
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < s.length; i++) {
    const ch = s[i]
    if (inStr) {
      if (esc) esc = false
      else if (ch === '\\') esc = true
      else if (ch === '"') inStr = false
      continue
    }
    if (ch === '"') inStr = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return s.slice(start, i + 1)
    }
  }
  return null
}

// Common slips: trailing commas, raw newlines/tabs inside strings
function repair(s: string): string {
  let out = ''
  let inStr = false
  let esc = false
  for (const ch of s) {
    if (inStr) {
      if (esc) { esc = false; out += ch; continue }
      if (ch === '\\') { esc = true; out += ch; continue }
      if (ch === '"') { inStr = false; out += ch; continue }
      if (ch === '\n') { out += '\\n'; continue }
      if (ch === '\r') continue
      if (ch === '\t') { out += '\\t'; continue }
      out += ch
    } else {
      if (ch === '"') inStr = true
      out += ch
    }
  }
  return out.replace(/,\s*([}\]])/g, '$1')
}

export interface ToolAction {
  tool: string
  args: Record<string, unknown>
}

export interface AgentTurn {
  thought: string
  actions: ToolAction[]
}

/** Chaves de controle de uma ação — o resto, quando não há "args", são os próprios argumentos. */
const ACTION_KEYS = new Set(['tool', 'name', 'action', 'type', 'id', 'thought', 'function', 'args', 'arguments', 'parameters', 'params', 'input'])

/**
 * Argumentos de uma ação em qualquer dos formatos que os modelos usam na prática:
 * {"args":{…}}, {"arguments":{…}} ou como TEXTO JSON (chamada nativa), {"parameters":{…}},
 * {"input":{…}}, {"function":{"name","arguments"}} ou soltos ao lado de "tool"
 * ({"tool":"write_file","path":"a.ts","content":"…"} — o Gemini Flash-Lite faz isso).
 */
export function actionArgs(a: Record<string, unknown>): Record<string, unknown> {
  const fn = a.function && typeof a.function === 'object' ? a.function as Record<string, unknown> : undefined
  for (const v of [a.args, a.arguments, a.parameters, a.params, a.input, fn?.arguments, fn?.parameters]) {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    if (typeof v === 'string' && v.trim().startsWith('{')) {
      try { const o = extractJson(v); if (o && typeof o === 'object' && !Array.isArray(o)) return o as Record<string, unknown> } catch { /* texto não-JSON */ }
    }
  }
  const loose: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(a)) if (!ACTION_KEYS.has(k)) loose[k] = v
  return loose
}

function actionTool(a: Record<string, unknown>): string {
  const fn = a.function && typeof a.function === 'object' ? (a.function as Record<string, unknown>).name : undefined
  for (const v of [a.tool, a.name, fn, a.action]) if (typeof v === 'string' && /^[a-z_][\w.-]*$/i.test(v)) return v
  return ''
}

export function parseAgentTurn(text: string): AgentTurn {
  const raw = extractJson(text) as Record<string, unknown>
  const list = Array.isArray(raw.actions) ? raw.actions : Array.isArray(raw.tool_calls) ? raw.tool_calls : actionTool(raw) ? [raw] : []
  const parsed: ToolAction[] = list
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && !!actionTool(a as Record<string, unknown>))
    .map(a => ({ tool: actionTool(a), args: actionArgs(a) }))
  if (!parsed.length) throw new Error('Nenhuma ação encontrada. Responda com {"thought": "...", "actions": [{"tool": "...", "args": {...}}]}')
  return { thought: typeof raw.thought === 'string' ? raw.thought : '', actions: parsed.slice(0, 8) }
}
