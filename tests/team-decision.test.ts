import { describe, expect, it } from 'vitest'
import { decideTeam } from '@/lib/agents/teamDecision'

const plano = (texto: string) => decideTeam(texto).plan

describe('o padrão é um agente só', () => {
  it('pedido simples não monta equipe', () => {
    expect(plano('liste os arquivos do projeto')).toBe('solo')
    expect(plano('corrija o erro de digitação no README')).toBe('solo')
    expect(plano('rode os testes')).toBe('solo')
    expect(plano('leia o package.json e me diga a versão')).toBe('solo')
  })

  it('uma frente só continua solo, mesmo sendo trabalho de verdade', () => {
    expect(plano('crie a tela de login em React')).toBe('solo')
    expect(plano('escreva testes para o módulo de permissões')).toBe('solo')
    expect(plano('configure o docker do projeto')).toBe('solo')
  })

  it('pedido vazio não quebra', () => {
    expect(plano('')).toBe('solo')
    expect(plano('   ')).toBe('solo')
  })
})

describe('equipe quando o pedido junta frentes diferentes', () => {
  it('sistema completo com camadas vira equipe', () => {
    expect(plano('crie um sistema completo de gerenciamento financeiro com login, banco de dados, dashboard e relatórios')).toBe('equipe')
    expect(plano('quero uma aplicação completa do zero com frontend e backend')).toBe('equipe')
  })

  it('três frentes diferentes bastam', () => {
    expect(plano('faça o backend, a interface e os testes disso')).toBe('equipe')
    expect(plano('preciso de api, banco de dados e deploy')).toBe('equipe')
  })

  it('duas frentes com várias entregas também', () => {
    expect(plano('crie a api, a tela de cadastro, a de listagem e a de edição')).toBe('equipe')
  })

  it('lista com vários itens conta como várias entregas', () => {
    const pedido = [
      'monte o projeto:',
      '- api de usuários',
      '- tela de login',
      '- testes de integração',
      '- documentação',
    ].join('\n')
    expect(plano(pedido)).toBe('equipe')
  })
})

describe('o usuário manda mais que a heurística', () => {
  it('pedir equipe explicitamente vence', () => {
    const d = decideTeam('use uma equipe para corrigir esse typo')
    expect(d.plan).toBe('equipe')
    expect(d.explicit).toBe(true)
  })

  it('pedir para resolver sozinho vence', () => {
    const d = decideTeam('crie um sistema completo com frontend, backend e banco — mas faça sozinho')
    expect(d.plan).toBe('solo')
    expect(d.explicit).toBe(true)
  })

  it('"em paralelo" e "vários agentes" ligam a equipe', () => {
    expect(plano('trabalhem em paralelo nisso')).toBe('equipe')
    expect(plano('quero vários agentes nesse projeto')).toBe('equipe')
  })
})

describe('motivo explicado ao usuário', () => {
  it('sempre vem em português e sem jargão', () => {
    for (const texto of ['liste os arquivos', 'crie um sistema completo com api e banco e testes', 'use uma equipe']) {
      const d = decideTeam(texto)
      expect(d.reason.length).toBeGreaterThan(8)
      expect(d.reason).not.toMatch(/[A-Z]{3,}|undefined|null/)
    }
  })

  it('não marca como explícito o que foi palpite nosso', () => {
    expect(decideTeam('crie um sistema completo com frontend, backend e banco').explicit).toBe(false)
  })
})
