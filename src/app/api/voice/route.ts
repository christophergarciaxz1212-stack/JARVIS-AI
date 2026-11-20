import { NextRequest } from 'next/server'
import { GEMINI_VOICES, listTtsModels, speakableText } from '@/lib/voice/gemini'
import { speakText, type VoicePrefs } from '@/lib/voice/narrate'
import { getPrefs } from '@/lib/prefs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const fail = (message: string, status = 400) => Response.json({ error: message }, { status })

export async function GET() {
  let models: Awaited<ReturnType<typeof listTtsModels>> = []
  let modelsError: string | undefined
  try { models = await listTtsModels() } catch (e) { modelsError = (e as Error).message }
  return Response.json({ voices: GEMINI_VOICES, models, modelsError, geminiConfigured: !!process.env.GEMINI_API_KEY, prefs: getPrefs().voice })
}

export async function POST(req: NextRequest) {
  let body: { text?: string; preview?: boolean; voice?: string; model?: string; style?: string; provider?: string }
  try { body = await req.json() } catch { return fail('JSON inválido') }
  const override: Partial<VoicePrefs> = {}
  if (typeof body.voice === 'string') override.voice = body.voice
  if (typeof body.model === 'string') override.model = body.model
  if (typeof body.style === 'string') override.style = body.style
  if (body.provider === 'gemini' || body.provider === 'windows') override.provider = body.provider
  const voiceName = override.voice || getPrefs().voice.voice
  const text = body.preview
    ? `Olá! Eu sou a voz ${voiceName}. É assim que o JARVIS vai falar com você e narrar os seus vídeos.`
    : speakableText(String(body.text || '')).slice(0, 6000)
  if (!text) return fail('Nada para falar')
  try {
    const r = await speakText(text, override, req.signal)
    return new Response(new Uint8Array(r.wav), {
      headers: {
        'content-type': 'audio/wav',
        'cache-control': 'no-store',
        'x-voice-provider': encodeURIComponent(r.provider),
        ...(r.note ? { 'x-voice-note': encodeURIComponent(r.note.slice(0, 300)) } : {}),
      },
    })
  } catch (e) {
    return fail((e as Error).message, 502)
  }
}
