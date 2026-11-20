/** Extrai marcadores [[video:<uuid>]] do texto da mensagem (cartões inline do Estúdio). */
export function extractVideoTags(content: string): { clean: string; videoJobs: string[] } {
  const re = /\[\[video:([0-9a-fA-F-]{36})\]\]/g
  const videoJobs = [...content.matchAll(re)].map(m => m[1])
  const clean = content.replace(re, '').replace(/\n{3,}/g, '\n\n').trim()
  return { clean, videoJobs }
}
