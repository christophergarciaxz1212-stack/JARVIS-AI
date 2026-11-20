import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { memoryIntent } from '@/lib/chat/memoryIntent'
import { promptCraftIntent, promptCraftContext } from '@/lib/chat/promptCraft'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'

describe('memória: entende os pedidos', () => {
  it('salvar', () => {
    expect(memoryIntent('lembre que meu aniversário é 12 de março')).toEqual({ action: 'save', content: 'meu aniversário é 12 de março' })
    expect(memoryIntent('Jarvis, anote que prefiro respostas curtas')).toEqual({ action: 'save', content: 'prefiro respostas curtas' })
    expect(memoryIntent('não esqueça que meu time é o Cruzeiro.')).toEqual({ action: 'save', content: 'meu time é o Cruzeiro' })
    expect(memoryIntent('guarde isso: a senha do wifi fica na gaveta')).toMatchObject({ action: 'save', content: 'a senha do wifi fica na gaveta' })
  })
  it('esquecer e listar', () => {
    expect(memoryIntent('esqueça que meu time é o Cruzeiro')).toEqual({ action: 'forget', query: 'meu time é o Cruzeiro' })
    expect(memoryIntent('apague da memória o meu aniversário')).toMatchObject({ action: 'forget' })
    expect(memoryIntent('o que você lembra sobre mim?')).toEqual({ action: 'list', query: undefined })
    expect(memoryIntent('liste suas memórias')).toMatchObject({ action: 'list' })
  })
  it('não confunde com conversa normal', () => {
    expect(memoryIntent('o que você sabe sobre buracos negros?')).toBeNull()
    expect(memoryIntent('lembra que eu te falei do projeto?')).toBeNull()
    expect(memoryIntent('esqueça isso, vamos falar de outra coisa')).toBeNull()
    expect(memoryIntent('me lembre de me avisar amanhã às 9h')).toBeNull()
    expect(memoryIntent('qual é a capital da França?')).toBeNull()
  })
})

describe('memória: guarda, atualiza, usa e apaga de verdade', () => {
  const OLD = process.env.JARVIS_DATA_DIR
  let dir = ''
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jv-mem-')); process.env.JARVIS_DATA_DIR = dir })
  afterAll(() => { if (OLD === undefined) delete process.env.JARVIS_DATA_DIR; else process.env.JARVIS_DATA_DIR = OLD; fs.rmSync(dir, { recursive: true, force: true }) })

  it('ciclo completo', async () => {
    const { memoryCommandRunner, memorySystemContext } = await import('@/lib/chat/memory')
    expect(await memoryCommandRunner('lembre que meu nome é Christopher')!()).toMatch(/Guardado/)
    expect(await memoryCommandRunner('lembre que meu time é o Cruzeiro')!()).toMatch(/Guardado/)
    // mesma informação, valor novo → substitui em vez de duplicar
    expect(await memoryCommandRunner('lembre que meu time é o Atlético')!()).toMatch(/atualizada/)
    // vai para o system prompt de qualquer conversa, mesmo sem palavra em comum
    const ctx = memorySystemContext('quanto é 2+2?')
    expect(ctx).toContain('meu nome é Christopher')
    expect(ctx).toContain('meu time é o Atlético')
    expect(ctx).not.toContain('Cruzeiro')
    expect(await memoryCommandRunner('o que você lembra sobre mim?')!()).toMatch(/Christopher[\s\S]*Atlético|Atlético[\s\S]*Christopher/)
    expect(await memoryCommandRunner('esqueça que meu time é o Atlético')!()).toMatch(/Esqueci/)
    expect(memorySystemContext('oi')).not.toContain('Atlético')
    expect(await memoryCommandRunner('esqueça que eu moro em Paris')!()).toMatch(/Não encontrei/)
    expect(memorySystemContext('oi')).toContain('Christopher')
  })
})

describe('criação de prompts', () => {
  it('detecta o pedido e o tipo de ferramenta', () => {
    expect(promptCraftIntent('crie um prompt para o Midjourney de um gato astronauta')).toEqual({ target: 'imagem', improve: false })
    expect(promptCraftIntent('faça um prompt para gerar vídeo no Sora de uma praia')).toMatchObject({ target: 'video' })
    expect(promptCraftIntent('melhore este prompt: escreva um post sobre café')).toMatchObject({ target: 'texto', improve: true })
    expect(promptCraftIntent('crie um system prompt para um agente de atendimento')).toMatchObject({ target: 'sistema' })
    expect(promptCraftIntent('quero um prompt para o Claude Code criar uma API')).toMatchObject({ target: 'codigo' })
  })
  it('não confunde com o prompt de comando do Windows nem com perguntas comuns', () => {
    expect(promptCraftIntent('abra o prompt de comando e rode ipconfig')).toBeNull()
    expect(promptCraftIntent('qual é a capital da França?')).toBeNull()
  })
  it('o guia pede o prompt pronto num bloco de código e as melhorias quando é para melhorar', () => {
    const c = promptCraftContext('melhore este prompt: escreva um post sobre café')
    expect(c).toMatch(/```text/)
    expect(c).toMatch(/O que mudei/)
    expect(promptCraftContext('crie um prompt para o Midjourney')).toMatch(/INGLÊS[\s\S]*--ar/)
  })
  it('o modo Agente deixa memória e prompts para o chat', () => {
    expect(shouldRunAgent('lembre que meu nome é Christopher')).toBe(false)
    expect(shouldRunAgent('crie um prompt para o Midjourney de um gato')).toBe(false)
  })
})
