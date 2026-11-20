/**
 * Criação de prompts: quando o usuário pede "crie um prompt para…", "melhore este prompt",
 * "prompt para Midjourney/Sora/ChatGPT…", o chat recebe um guia de engenharia de prompt e um
 * formato de entrega fixo (prompt pronto para copiar num bloco de código). Puro e testável.
 */
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

export type PromptTarget = 'imagem' | 'video' | 'codigo' | 'sistema' | 'texto'

export function promptCraftIntent(message: string): { target: PromptTarget; improve: boolean } | null {
  const t = norm(message)
  // "prompt de comando" / "prompt do terminal" é o terminal do Windows, não prompt de IA
  if (/\bprompt (de comando|do comando|do terminal|do windows|do cmd|do powershell)\b|\bcommand prompt\b/.test(t)) return null
  const asks = /\b(cri[ea]r?|escrev[ea]r?|fa[cz]a?|gere|gera|gerar|mont[ea]|elabor[ea]|me (de|da|passa|manda)|quero|preciso de|otimiz[ea]|melhor[ea]|reescrev[ea]|refin[ea]|ajust[ea]|corrij[ae])\b[^\n]{0,60}\bprompts?\b|\bprompts? (para|pra|pro|de|do|da)\b|\bengenharia de prompts?\b|\bsystem prompt\b|\bmega ?prompt\b/
  if (!asks.test(t)) return null
  const improve = /\b(melhor[ea]|otimiz[ea]|reescrev[ea]|refin[ea]|ajust[ea]|corrij[ae]|deixe melhor|esse prompt|este prompt)\b/.test(t)
  const target: PromptTarget =
    /\b(midjourney|stable diffusion|sdxl|flux|dall-?e|leonardo|ideogram|imagens?|fotos?|ilustrac\w*|logo|arte|thumbnail|wallpaper)\b/.test(t) ? 'imagem'
    : /\b(sora|veo|kling|runway|pika|hailuo|luma|videos?|clipe|cena|filmagem)\b/.test(t) ? 'video'
    : /\b(codigo|programa\w*|script|api|app|aplicativo|site|cursor|copilot|claude code|bug|funcao)\b/.test(t) ? 'codigo'
    : /\b(system prompt|agente|assistente|chatbot|gpt personalizado|custom gpt|persona|bot)\b/.test(t) ? 'sistema'
    : 'texto'
  return { target, improve }
}

const TARGET_GUIDE: Record<PromptTarget, string> = {
  texto: `Prompt para IA de texto (ChatGPT, Claude, Gemini…). Estrutura: **Papel** (quem a IA é, com experiência concreta) → **Contexto** (situação, público, objetivo, o que já existe) → **Tarefa** (verbo de ação, específica e mensurável) → **Restrições** (tom, tamanho, o que evitar, idioma) → **Formato da saída** (seções, tabela, lista, tamanho exato) → **Exemplo** curto quando o formato importa → **Critério de qualidade** (como saber que ficou bom). Use [COLCHETES] para o que o usuário precisa preencher.`,
  imagem: `Prompt para IA de imagem (Midjourney, Flux, SDXL, DALL·E, Ideogram). Escreva o prompt final em INGLÊS (rendem melhor), numa linha: **sujeito** detalhado → **ação/pose** → **ambiente/cenário** → **estilo/meio** (photo, 3D render, anime, oil painting…) → **iluminação** → **composição/câmera** (lente, ângulo, enquadramento) → **paleta/clima** → **qualidade** (highly detailed, sharp focus). Para Midjourney inclua parâmetros no fim (--ar 16:9 --v 6 --style raw quando fizer sentido). Ofereça também o **negative prompt** (para SD/Flux). Explique em português, em 2-3 linhas, o que cada parte faz.`,
  video: `Prompt para IA de vídeo (Sora, Veo, Kling, Runway, Pika, Hailuo). Prompt final em INGLÊS, descrevendo UM plano contínuo: **sujeito** → **ação ao longo do tempo** (começo → fim) → **cenário** → **movimento de câmera** (dolly in, tracking shot, orbit, handheld…) → **lente/enquadramento** → **iluminação e hora do dia** → **estilo** (cinematic, documentary, 3D animation, anime) → **ritmo/clima**. 1 cena por prompt, 5–10 s. Se o usuário quer várias cenas, entregue um prompt por cena, numerados, mantendo personagem e estilo idênticos (descreva o personagem igual em todos).`,
  codigo: `Prompt para IA de programação (Claude Code, Cursor, Copilot, ChatGPT). Estrutura: **objetivo** (o que deve funcionar no fim) → **contexto técnico** (linguagem, framework, versões, arquivos/pastas relevantes) → **requisitos** numerados e testáveis → **restrições** (não mudar X, sem novas dependências, padrão de código) → **critérios de aceite** (testes que devem passar, comportamento esperado) → **formato da resposta** (diff, arquivos completos, passos). Peça para a IA verificar (rodar testes/build) antes de concluir.`,
  sistema: `System prompt para agente/assistente/GPT personalizado. Estrutura: **identidade e missão** → **público e tom** → **o que faz / o que NÃO faz** → **regras operacionais** numeradas e verificáveis → **como lidar com dúvidas e falta de dados** (perguntar vs. assumir) → **formato padrão das respostas** → **exemplos** de 1–2 interações ideais → **limites e segurança**. Frases curtas e imperativas; nada vago ("seja útil").`,
}

/** Bloco do system prompt para pedidos de criação/melhoria de prompt. */
export function promptCraftContext(message: string): string {
  const intent = promptCraftIntent(message)
  if (!intent) return ''
  return `\n\n# Modo: engenharia de prompt
O usuário quer ${intent.improve ? 'MELHORAR um prompt' : 'um PROMPT pronto para usar'}. Você é especialista em engenharia de prompt.
${TARGET_GUIDE[intent.target]}

Entregue SEMPRE neste formato:
1. Uma linha dizendo para qual ferramenta/uso o prompt foi feito.
2. O prompt final completo dentro de UM bloco de código \`\`\`text (pronto para copiar, sem comentários dentro).
3. "**Como usar**": 2–4 itens curtos (o que preencher nos [COLCHETES], dicas de ajuste).
${intent.improve ? '4. "**O que mudei**": 3–5 itens curtos explicando as melhorias em relação ao original.\n' : ''}- Se faltar informação essencial, NÃO pergunte antes: faça o melhor prompt com suposições razoáveis, deixe [COLCHETES] onde o usuário deve completar e diga numa linha o que assumiu.
- Seja específico e concreto: nada de instruções vagas como "seja criativo" ou "faça o melhor possível".`
}
