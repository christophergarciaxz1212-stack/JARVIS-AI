/** What a chat message asks about networks/infra (pure: used by the server and by the client router). */
export type NetIntent = 'infra-report' | 'topology-report' | 'design' | 'edit' | 'env-diagram' | 'export' | 'validate' | 'deploy' | 'destroy' | null

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export function netIntent(text: string, hasTopology = false): NetIntent {
  const t = norm(text.trim())
  if (!t || t.startsWith('/') || t.length > 4000) return null
  // Only network words: "teste o projeto" / "exporte o projeto" are software requests for the agent
  const labRef = /\b(lab|laboratorio|topologia|rede|diagrama)\b/.test(t)
  if (hasTopology) {
    if (/\b(containerlab|clab|eve-?ng|\.unl|gns3)\b/.test(t) && /\b(export|gere|gera|baix|salv|arquivo|abr|import|mand|quero)\w*/.test(t)) return 'export'
    if (/\b(export|baix)\w*\b/.test(t) && labRef) return 'export'
    if (/\b(derrub|destru|par[ae]|deslig|encerr|desmont)\w*\b/.test(t) && /\b(lab|laboratorio|containerlab)\b/.test(t)) return 'destroy'
    if (/\b(sub[ae]|suba|inici|rod[ae]|execut|lig[ue]|deploy|implant|levant)\w*\b/.test(t) && /\b(lab|laboratorio|containerlab|equipamentos|topologia)\b/.test(t) && !/\b(adicion|acrescent)/.test(t)) return 'deploy'
    if (((/\b(valid|test|verifiq|verific|simul)\w*/.test(t) && labRef) || /\b(ping|alcance|conectividade|comunicacao)\b/.test(t)) && !/\b(relatorio|pdf)\b/.test(t)) return 'validate'
  }
  const report = /\b(relatorio|report|documentacao|documento|pdf|docx|word)\b/.test(t)
  const designWords = /\b(topologia|projeto de rede|diagrama|lab(oratorio)?|eve-?ng|ivng|desse projeto|dessa rede|desta rede|deste projeto)\b/.test(t)
  if (report && hasTopology && /\b(topologia|projeto|diagrama|lab|dessa rede|desta rede|desse|deste)\b/.test(t)) return 'topology-report'
  if (report && /\b(rede|redes|infra|infraestrutura|servidor|servidores|network|ambiente|ti|maquina|computador)\b/.test(t) && !designWords) return 'infra-report'
  if (/\b(diagrama|desenho|mapa|imagem|topologia)\b.{0,40}\b(minha rede|da minha infra|do meu ambiente|da rede local|do meu pc|da minha casa|do meu computador)\b/.test(t)) return 'env-diagram'
  if (hasTopology && /\b(adicion|acrescent|inclu|remov|retir|tir[ae]|troqu|troca|substitu|mud[ae]|alter|lig[ue]|conect|coloqu|mov[ae]|renome|duplique|crie mais|aumente)\w*\b/.test(t)
    && /\b(rede|topologia|diagrama|lab|switch|roteador|router|firewall|fortigate|servidor|vlan|link|cabo|porta|zona|dmz|filial|site|isp|operadora|core|access|ha|vpn|nuvem|aws|azure)\b/.test(t)) return 'edit'
  if (/\b(topologia|diagrama de rede|projeto de rede|lab(oratorio)? de redes?|eve-?ng|ivng|modelo de rede|arquitetura de rede|desenho de rede)\b/.test(t)) return 'design'
  if (/\b(desenh|mont|cri|projet|simul|planej|fac|faz)\w*\b.{0,40}\b(uma |a |minha |nova )?(rede|lan|wan|infraestrutura de rede|datacenter|filial)\b/.test(t) && !/\b(rede social|redes sociais|neural)\b/.test(t)) return 'design'
  return null
}

const TOPO_MARKER = /\[\[topology:([0-9a-f-]{36})\]\]/g

/** Latest topology shown in a conversation (so "adicione um servidor" edits it). */
export function lastTopologyIn(contents: string[]): string | undefined {
  for (let i = contents.length - 1; i >= 0; i--) {
    const all = [...(contents[i] || '').matchAll(TOPO_MARKER)]
    if (all.length) return all[all.length - 1][1]
  }
  return undefined
}
