/** Extrai marcadores [[video:<uuid>]] do texto da mensagem (cartões inline do Estúdio). */
export function extractVideoTags(content: string): { clean: string; videoJobs: string[] } {
  const re = /\[\[video:([0-9a-fA-F-]{36})\]\]/g
  const videoJobs = [...content.matchAll(re)].map(m => m[1])
  const clean = content.replace(re, '').replace(/\n{3,}/g, '\n\n').trim()
  return { clean, videoJobs }
}

/** Extrai marcadores [[imagem:<uuid>]] do texto da mensagem (cartões inline de imagem). */
export function extractImageTags(content: string): { clean: string; imageJobs: string[] } {
  const re = /\[\[imagem:([0-9a-fA-F-]{36})\]\]/g
  const imageJobs = [...content.matchAll(re)].map(m => m[1])
  const clean = content.replace(re, '').replace(/\n{3,}/g, '\n\n').trim()
  return { clean, imageJobs }
}

/** Extrai ambos os tipos de marcadores */
export function extractAllTags(content: string): {
  clean: string
  videoJobs: string[]
  imageJobs: string[]
} {
  const videoResult = extractVideoTags(content)
  const imageResult = extractImageTags(content)
  return {
    clean: videoResult.clean,
    videoJobs: videoResult.videoJobs,
    imageJobs: imageResult.imageJobs,
  }
}