import { describe, it, expect } from 'vitest'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'

describe('shouldRunAgent', () => {
  const executa = [
    'Crie um arquivo hello.txt com o texto JARVIS OK',
    'Como faço para criar um arquivo .env?',
    'Quais arquivos contêm a palavra SEGREDO?',
    'Rode node app.js e me diga a saída',
    'Corrija a função add no buggy.js',
    'Como está o meu PC?',
    'Analise o arquivo nota.txt',
    'Qual a versão do Node instalada neste computador?',
    'Quais programas estão instalados?',
    'Quanto espaço livre tem nesse pc?',
    'Quantas linhas tem o arquivo dados.csv?',
  ]
  const conversa = [
    'Oi, tudo bem?',
    'O que é um arquivo .env?',
    'Qual é a capital da França?',
    'Explique o erro no buggy.js',
    'Quanto é 2 + 2?',
    '/pesquisa-tecnica explique o pedido',
    'gere uma imagem de um gato',
    'Quantas capitais tem o Brasil?',
  ]

  for (const text of executa) {
    it(`manda para o agente: ${text}`, () => {
      expect(shouldRunAgent(text)).toBe(true)
    })
  }

  for (const text of conversa) {
    it(`mantém no chat: ${text}`, () => {
      expect(shouldRunAgent(text)).toBe(false)
    })
  }
})
