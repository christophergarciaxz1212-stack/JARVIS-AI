import { describe, expect, it } from 'vitest'
import {
  activeFileQuery, findCommand, helpText, parseOnOff, parsePermissionArg,
  parseSlash, referencedFiles, SLASH_COMMANDS, suggestCommands,
} from '@/lib/chat/slash'

describe('catálogo de comandos', () => {
  it('não tem nome repetido entre comandos e apelidos', () => {
    const nomes = SLASH_COMMANDS.flatMap(c => [c.name, ...(c.aliases ?? [])])
    expect(new Set(nomes).size).toBe(nomes.length)
  })

  it('todo comando tem descrição e lugar de execução', () => {
    for (const c of SLASH_COMMANDS) {
      expect(c.description.length, c.name).toBeGreaterThan(5)
      expect(['cliente', 'servidor']).toContain(c.where)
    }
  })

  it('o /help é montado do catálogo, então não desatualiza', () => {
    const txt = helpText()
    for (const c of SLASH_COMMANDS) expect(txt).toContain(`/${c.name}`)
  })
})

describe('leitura do comando', () => {
  it('separa o comando do argumento', () => {
    const p = parseSlash('/plan reorganizar a pasta src')!
    expect(p.command.name).toBe('plan')
    expect(p.arg).toBe('reorganizar a pasta src')
  })

  it('aceita apelidos em português, com e sem acento', () => {
    expect(parseSlash('/ajuda')!.command.name).toBe('help')
    expect(parseSlash('/planejar algo')!.command.name).toBe('plan')
    expect(parseSlash('/modelo')!.command.name).toBe('model')
    expect(parseSlash('/permissao autonomo')!.command.name).toBe('mode')
    expect(parseSlash('/extensoes')!.command.name).toBe('skills')
  })

  it('comando sem argumento devolve argumento vazio', () => {
    const p = parseSlash('/status')!
    expect(p.command.name).toBe('status')
    expect(p.arg).toBe('')
  })

  it('não captura o que não é comando conhecido', () => {
    // Uma skill instalada continua recebendo "/nome-da-skill pedido"
    expect(parseSlash('/minha-skill faça algo')).toBeNull()
    expect(parseSlash('texto comum')).toBeNull()
    expect(parseSlash('veja src/a.ts e /outro')).toBeNull()
    expect(parseSlash('')).toBeNull()
  })

  it('acha comando pelo nome com ou sem a barra', () => {
    expect(findCommand('/status')?.name).toBe('status')
    expect(findCommand('status')?.name).toBe('status')
    expect(findCommand('inexistente')).toBeNull()
  })
})

describe('sugestões enquanto digita', () => {
  it('barra sozinha sugere tudo', () => {
    expect(suggestCommands('/')).toHaveLength(SLASH_COMMANDS.length)
  })

  it('prefixo filtra por nome e por apelido', () => {
    // "/pl" casa com o nome "plan" e com o apelido "plugins" de /skills
    expect(suggestCommands('/pl').map(c => c.name).sort()).toEqual(['plan', 'skills'])
    expect(suggestCommands('/plan').map(c => c.name)).toEqual(['plan'])
    expect(suggestCommands('/mod').map(c => c.name).sort()).toEqual(['mode', 'model'])
    expect(suggestCommands('/aju').map(c => c.name)).toEqual(['help'])
  })

  it('sem prefixo batendo, procura na descrição', () => {
    expect(suggestCommands('/autonomia').map(c => c.name)).toContain('mode')
  })

  it('nada parecido devolve lista vazia, e não a lista inteira', () => {
    expect(suggestCommands('/zzzzz')).toHaveLength(0)
  })
})

describe('argumentos', () => {
  it('aceita modo de permissão abreviado', () => {
    expect(parsePermissionArg('restrito')).toBe('restrito')
    expect(parsePermissionArg('sup')).toBe('supervisionado')
    expect(parsePermissionArg('autônomo')).toBe('autonomo')
    expect(parsePermissionArg('qualquer')).toBeNull()
    expect(parsePermissionArg('')).toBeNull()
  })

  it('entende ligar e desligar em português', () => {
    expect(parseOnOff('on')).toBe(true)
    expect(parseOnOff('ligar')).toBe(true)
    expect(parseOnOff('off')).toBe(false)
    expect(parseOnOff('desligar')).toBe(false)
    expect(parseOnOff('')).toBeNull()
  })
})

describe('referência a arquivos com @', () => {
  it('detecta o trecho sendo digitado depois do @', () => {
    const t = 'olha o @src/lib'
    const q = activeFileQuery(t, t.length)!
    expect(q.query).toBe('src/lib')
    expect(q.start).toBe(t.indexOf('@'))
  })

  it('@ no começo da mensagem conta', () => {
    expect(activeFileQuery('@pack', 5)!.query).toBe('pack')
  })

  it('e-mail não vira referência de arquivo', () => {
    expect(activeFileQuery('escreva para joao@empresa.com', 29)).toBeNull()
  })

  it('espaço encerra a referência', () => {
    expect(activeFileQuery('@src/a.ts e mais', 16)).toBeNull()
  })

  it('fora de um @ não sugere nada', () => {
    expect(activeFileQuery('texto comum', 11)).toBeNull()
  })

  it('lista os arquivos citados na mensagem', () => {
    expect(referencedFiles('compare @src/a.ts com @src/b.ts, por favor'))
      .toEqual(['src/a.ts', 'src/b.ts'])
  })

  it('ignora e-mail e remove pontuação final', () => {
    expect(referencedFiles('fale com joao@empresa.com sobre @README.md.')).toEqual(['README.md'])
  })

  it('sem @ devolve lista vazia', () => {
    expect(referencedFiles('mensagem sem referência')).toEqual([])
  })
})
