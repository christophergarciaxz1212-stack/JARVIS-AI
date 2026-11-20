// Inline media markers carried in chat messages: [[motion:<job-id>]] and [[document:<file>]]
// The server stores the markers in the message content, so the cards survive reloads and replays.

const MARKER = /\[\[motion:([0-9a-fA-F-]{36})\]\]/g
const DOC_MARKER = /\[\[document:([\w][\w.\-]{0,120})\]\]/g
const ANY_MARKER = /\[\[(motion:[0-9a-fA-F-]{36}|document:[\w][\w.\-]{0,120})\]\]/g

/** Extracts motion job markers from message content; returns cleaned text plus the job ids. */
export function extractMotionJobs(content: string): { clean: string; jobs: string[] } {
  const jobs: string[] = []
  if (!content) return { clean: '', jobs }
  const clean = content.replace(MARKER, (_full, id: string) => {
    jobs.push(id)
    return ''
  }).trim()
  return { clean, jobs }
}

/** Extracts generated-document markers; returns cleaned text plus the filenames. */
export function extractDocuments(content: string): { clean: string; documents: string[] } {
  const documents: string[] = []
  if (!content) return { clean: '', documents }
  const clean = content.replace(DOC_MARKER, (_full, file: string) => {
    documents.push(file)
    return ''
  }).trim()
  return { clean, documents }
}

const TOPOLOGY_MARKER = /\[\[topology:([0-9a-f-]{36})\]\]/g

/** Extracts every inline-media marker at once (motion + document + network topology). */
export function extractAll(content: string): { clean: string; motionJobs: string[]; documents: string[]; topologies: string[] } {
  const motionJobs: string[] = []
  const documents: string[] = []
  const topologies: string[] = []
  if (!content) return { clean: '', motionJobs, documents, topologies }
  const clean = content
    .replace(TOPOLOGY_MARKER, (_full, id: string) => { if (!topologies.includes(id)) topologies.push(id); return '' })
    .replace(ANY_MARKER, (_full, body: string) => {
      if (body.startsWith('motion:')) motionJobs.push(body.slice('motion:'.length))
      else documents.push(body.slice('document:'.length))
      return ''
    }).trim()
  return { clean, motionJobs, documents, topologies }
}

/** Cuts a trailing, unterminated marker so the streaming view never flashes raw syntax. */
export function hidePartialMarker(content: string): string {
  if (!content) return content
  const i = content.lastIndexOf('[[')
  if (i === -1) return content
  const tail = content.slice(i)
  if (tail.includes(']]')) return content // marker already complete — leave it for the extractor
  const partial = /^\[\[(m|mo|mot|moti|motio|motion|motion:|motion:[0-9a-fA-F-]{0,36}|d|do|doc|docu|docum|docume|documen|document|document:|document:[\w.\-]{0,120}|t|to|top|topo|topol|topolo|topolog|topology|topology:|topology:[0-9a-f-]{0,36})?$/
  return partial.test(tail) ? content.slice(0, i) : content
}
