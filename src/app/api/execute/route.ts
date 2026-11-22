import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import { StringDecoder } from 'string_decoder'
import fs from 'fs'

import { isSafeAgentCommand, killTree, runWithShell, shellEnv, shellInvocation, preferredShell, type ShellKind } from '@/lib/shell'

const STREAM_TIMEOUT_MS = 120_000
const MAX_COMMAND_LEN = 4000

export async function POST(req: NextRequest) {
  try {
    const { command, cwd, shell = 'auto', stream = false } = await req.json()
    const requested: ShellKind | 'auto' = shell === 'powershell' || shell === 'cmd' ? shell : 'auto'

    if (!command || typeof command !== 'string') {
      return Response.json({ error: 'Comando inválido' }, { status: 400 })
    }
    if (command.length > MAX_COMMAND_LEN) {
      return Response.json({ error: `Comando muito longo (máx. ${MAX_COMMAND_LEN} caracteres)` }, { status: 400 })
    }

    const blocked = isSafeAgentCommand(command)
    if (blocked) {
      return Response.json({
        error: `Comando bloqueado por segurança: ${blocked}`,
      }, { status: 403 })
    }

    const workDir = cwd || process.cwd()

    if (!fs.existsSync(workDir)) {
      return Response.json({ error: `Diretório não encontrado: ${workDir}` }, { status: 400 })
    }

    const start = Date.now()

    if (stream) {
      const encoder = new TextEncoder()
      let killChild: () => void = () => {}
      const readableStream = new ReadableStream({
        start(controller) {
          const chosen = requested === 'auto' ? preferredShell(command) : requested
          const { file, args, verbatim } = shellInvocation(chosen, command)

          const proc = spawn(file, args, {
            cwd: workDir,
            env: shellEnv(),
            windowsHide: true,
            windowsVerbatimArguments: verbatim,
          })

          // Hard stop: client disconnect is cancel() below; absolute ceiling here.
          const timer = setTimeout(() => { if (proc.pid) killTree(proc.pid) }, STREAM_TIMEOUT_MS)
          const send = (payload: Record<string, unknown>) => {
            try { controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`)) } catch {}
          }

          const outDecoder = new StringDecoder('utf8')
          const errDecoder = new StringDecoder('utf8')
          proc.stdout.on('data', (data: Buffer) => { const text = outDecoder.write(data); if (text) send({ type: 'stdout', text }) })
          proc.stderr.on('data', (data: Buffer) => { const text = errDecoder.write(data); if (text) send({ type: 'stderr', text }) })
          proc.on('close', (code: number | null) => {
            clearTimeout(timer)
            send({ type: 'done', exitCode: code, duration: Date.now() - start })
            try { controller.close() } catch {}
          })
          proc.on('error', (err: Error) => {
            clearTimeout(timer)
            send({ type: 'error', message: err.message })
            try { controller.close() } catch {}
          })

          // Client disconnect → the runtime calls cancel() below
          killChild = () => { clearTimeout(timer); if (proc.pid) killTree(proc.pid) }
        },
        cancel() {
          killChild()
        },
      })

      return new Response(readableStream, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        },
      })
    }

    // Non-streaming: kills the whole tree on timeout, output capped, env scrubbed
    const result = await runWithShell(command, workDir, { timeoutMs: 30_000, shell: requested })

    return Response.json({
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      duration: result.durationMs,
      command,
      cwd: workDir,
    })
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Erro desconhecido'
    return Response.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const action = searchParams.get('action')

  if (action === 'cwd') {
    return Response.json({ cwd: process.cwd() })
  }

  if (action === 'env') {
    return Response.json({ nodeVersion: process.version, platform: process.platform })
  }

  return Response.json({ status: 'ready' })
}
