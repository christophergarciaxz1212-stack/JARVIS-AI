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

export function parseAgentTurn(text: string): AgentTurn {
  const raw = extractJson(text) as Record<string, unknown>
  const actions = Array.isArray(raw.actions) ? raw.actions : raw.tool ? [raw] : []
  const parsed: ToolAction[] = actions
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).tool === 'string')
    .map(a => ({ tool: String(a.tool), args: (a.args && typeof a.args === 'object' ? a.args : {}) as Record<string, unknown> }))
  if (!parsed.length) throw new Error('Nenhuma ação encontrada. Responda com {"thought": "...", "actions": [{"tool": "...", "args": {...}}]}')
  return { thought: typeof raw.thought === 'string' ? raw.thought : '', actions: parsed.slice(0, 8) }
}
