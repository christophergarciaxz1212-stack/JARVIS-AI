import fs from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { NextRequest } from 'next/server'
import { dataDir } from '@/lib/agents/fsutil'
import { documentsDir, getDocument, listDocuments } from '@/lib/docs/generate'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SAFE_NAME = /^[\w][\w.\-]{0,120}\.(xlsx|pdf|md|csv|docx|yml|unl|gns3|zip)$/i
const TYPES: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.yml': 'text/yaml; charset=utf-8',
  '.unl': 'application/xml; charset=utf-8',
  '.gns3': 'application/json; charset=utf-8',
  '.zip': 'application/zip',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const action = sp.get('action') || 'file'

  if (action === 'list') {
    return Response.json({ documents: listDocuments().slice(0, 100) })
  }

  const file = String(sp.get('file') || '')
  if (!SAFE_NAME.test(file)) return Response.json({ error: 'Nome de arquivo inválido' }, { status: 400 })

  if (action === 'info') {
    const meta = getDocument(file)
    if (!meta) return Response.json({ error: 'Documento não encontrado' }, { status: 404 })
    return Response.json({ document: meta })
  }

  const dest = path.join(documentsDir(), file)
  // Must resolve inside documentsDir — no traversal even if the name looks safe
  if (path.dirname(dest) !== documentsDir()) return Response.json({ error: 'Caminho inválido' }, { status: 400 })
  if (!fs.existsSync(dest)) return Response.json({ error: 'Documento não encontrado' }, { status: 404 })

  const meta = getDocument(file)
  const size = fs.statSync(dest).size
  const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream'
  const headers: Record<string, string> = {
    'Content-Type': type,
    'Content-Length': String(size),
    'Content-Disposition': `attachment; filename="${file}"`,
    'Cache-Control': 'private, no-store',
  }
  return new Response(Readable.toWeb(fs.createReadStream(dest)) as unknown as ReadableStream<Uint8Array>, { headers })
}
