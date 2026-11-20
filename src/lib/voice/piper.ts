/** Piper TTS: motor de síntese de voz open source e offline.
 *  Leve suficiente para rodar em GPU 6GB + 32GB RAM.
 *  Suporta português brasileiro via modelos da comunidade no Hugging Face.
 *
 *  Como o Piper costuma ser invocado via CLI (`piper --text "..." --model model.onnx`),
 *  este módulo tenta localizar o binário ou usa o download automático.
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawn } from 'child_process'

/** Caminho onde baixaremos os modelos Piper automaticamente. */
const PIPER_CACHE = path.join(process.env.HOME || os.homedir(), '.jarvis', 'piper-models')

 /** Vozes portuguesas brasileiras (nomes amigáveis; IDs são do modelo .onnx). */
export interface VoiceInfo { id: string; name: string; language: string; gender: 'feminino' | 'masculino' }

export const PORTUGUESE_VOICES: Array<VoiceInfo> = [
  { id: 'pt_br_clara', name: 'Clara', language: 'pt-BR', gender: 'feminino' }
  , { id: 'pt_br_bruno', name: 'Bruno', language: 'pt-BR', gender: 'masculino' }
  , { id: 'pt_br_roberto', name: 'Roberto', language: 'pt-BR', gender: 'masculino' }
  , { id: 'pt_br_mariana', name: 'Mariana', language: 'pt-BR', gender: 'feminino' }
]

/** Inicializa o cache de modelos Piper (roda uma vez na primeira utilização). */
export async function initPiperCache(): Promise<void> {
  fs.mkdirSync(PIPER_CACHE, { recursive: true })
  // Verificar se já temos modelos; se não, a chamada será dirigida ao HF downloader mais tarde.
}

/** Sintetiza texto usando Piper.
 *  O Piper lê texto via stdin e outputa PCM16 mono no stdout.
 *  Retorna { pcm: Buffer, rate: number }.
 */
export async function synthesize(text: string, voiceId: string): Promise<{ pcm: Buffer; rate: number; seconds: number }> {
  // Garantir cache inicializado
  await initPiperCache()

  // Procurar modelo .onnx correspondente
  const modelFile = `${voiceId}.onnx`
  const modelPath = path.join(PIPER_CACHE, modelFile)

  // Se não existir, tentar baixar do Hugging Face (versão simplificada)
  if (!fs.existsSync(modelPath)) {
    try {
      // Tentativa de download do modelo pt_br_clara como exemplo
      if (voiceId === 'pt_br_clara') {
        const url = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/pt_br_clara/pt_br_clara.onnx'
        const fetch = (await import('node-fetch')).default
        const resp = await fetch(url)
        if (!resp.ok) throw new Error('Não foi possível baixar o modelo Piper')
        fs.writeFileSync(modelPath, await resp.buffer())
      } else {
        throw new Error(`Modelo Piper ${voiceId} não encontrado em cache. Baixe manualmente ou use pi_br_clara.`)
      }
    } catch (e) {
      throw new Error(`Erro ao preparar modelo Piper: ${(e as Error).message}`)
    }
  }

  // Executar o Piper via CLI
  return new Promise((resolve, reject) => {
    const proc = spawn('piper', ['--model', modelPath, '--output_raw'], {
      cwd: PIPER_CACHE,
      env: { ...process.env, PATH: process.env.PATH },
    })

    let pcmData = Buffer.from([])
    proc.stdout.on('data', (chunk: Buffer) => { pcmData = Buffer.concat([pcmData, chunk]) })
    proc.stderr.on('data', (_chunk: Buffer) => {}) // log, não bloqueia
    proc.on('error', (err: Error) => reject(err))
    proc.on('close', (code: number) => {
      if (code !== 0) {
        reject(new Error(`Piper terminou com código ${code}. Verifique se o binário piper está no PATH.`))
      } else {
        // Piper output raw é 16-bit PCM mono. Taxa padrão: 22050 Hz.
        const rate = 22050
        const seconds = pcmData.length / (2 * rate) // 2 bytes por amostra, mono
        resolve({ pcm: pcmData, rate, seconds })
      }
    })

    // O texto vai para o stdin
    proc.stdin!.write(text)
    proc.stdin!.end()
  })
}

/** Converte o raw PCM do Piper para um Buffer WAV (16-bit mono). */
export function pcmToWav(pcm: Buffer, rate: number = 22050): Buffer {
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16) // tamanho do sub-chunk fmt
  h.writeUInt16LE(1, 20) // format = PCM
  h.writeUInt16LE(1, 22) // canais = mono
  h.writeUInt32LE(rate, 24) // taxa de amostragem
  h.writeUInt32LE(rate * 2, 28) // byte rate
  h.writeUInt16LE(16, 34) // bits por amostra
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  // O Piper já entrega 16-bit PCM mono, então basta copiar
  const data = Buffer.concat([h, pcm])
  return data
}