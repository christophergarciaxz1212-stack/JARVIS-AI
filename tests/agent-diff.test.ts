import { describe, expect, it } from 'vitest'
import { fileDiff, looksBinary, toHunks } from '@/lib/agents/diff'

const text = (...lines: string[]) => lines.join('\n') + '\n'

describe('numeração das linhas do diff', () => {
  it('numera original e atual separadamente numa troca de linha', () => {
    const hunks = toHunks(text('a', 'b', 'c'), text('a', 'B', 'c'))
    expect(hunks).toHaveLength(1)
    const lines = hunks[0].lines

    const removida = lines.find(l => l.kind === 'removida')!
    const adicionada = lines.find(l => l.kind === 'adicionada')!
    expect(removida.text).toBe('b')
    expect(removida.before).toBe(2)
    expect(removida.after).toBeUndefined()
    expect(adicionada.text).toBe('B')
    expect(adicionada.after).toBe(2)
    expect(adicionada.before).toBeUndefined()

    // O contexto mantém os dois lados alinhados
    const primeira = lines[0]
    expect(primeira.kind).toBe('igual')
    expect(primeira.before).toBe(1)
    expect(primeira.after).toBe(1)
  })

  it('mantém a numeração correta depois de uma inserção', () => {
    const hunks = toHunks(text('a', 'b'), text('a', 'novo', 'b'))
    const b = hunks[0].lines.filter(l => l.text === 'b')[0]
    expect(b.before).toBe(2)
    expect(b.after).toBe(3)
  })
})

describe('contagem de alterações', () => {
  it('conta adicionadas e removidas, sem contar contexto', () => {
    const d = fileDiff({ path: 'a.ts', before: text('um', 'dois', 'tres'), after: text('um', 'DOIS', 'tres', 'quatro') })
    expect(d.added).toBe(2)
    expect(d.removed).toBe(1)
    expect(d.created).toBe(false)
    expect(d.deleted).toBe(false)
  })

  it('arquivo criado conta tudo como adicionado', () => {
    const d = fileDiff({ path: 'novo.ts', before: null, after: text('a', 'b') })
    expect(d.created).toBe(true)
    expect(d.added).toBe(2)
    expect(d.removed).toBe(0)
  })

  it('arquivo apagado conta tudo como removido', () => {
    const d = fileDiff({ path: 'velho.ts', before: text('a', 'b'), after: null })
    expect(d.deleted).toBe(true)
    expect(d.removed).toBe(2)
    expect(d.added).toBe(0)
  })

  it('arquivo sem alteração não gera trecho algum', () => {
    const d = fileDiff({ path: 'igual.ts', before: text('a', 'b'), after: text('a', 'b') })
    expect(d.hunks).toHaveLength(0)
    expect(d.added).toBe(0)
    expect(d.removed).toBe(0)
  })
})

describe('arquivos que não dá para mostrar', () => {
  it('reconhece binário e não tenta diferenciar linha a linha', () => {
    expect(looksBinary('abc\0def')).toBe(true)
    expect(looksBinary('texto normal com acento ç')).toBe(false)

    const d = fileDiff({ path: 'logo.png', before: 'PNG\0antes', after: 'PNG\0depois' })
    expect(d.binary).toBe(true)
    expect(d.hunks).toHaveLength(0)
  })

  it('corta o que não cabe na tela, mas a contagem continua verdadeira', () => {
    const antes = text(...Array.from({ length: 600 }, (_, i) => `linha ${i}`))
    const depois = text(...Array.from({ length: 600 }, (_, i) => `LINHA ${i}`))
    const d = fileDiff({ path: 'grande.ts', before: antes, after: depois })

    expect(d.truncated).toBe(true)
    expect(d.added).toBe(600)
    expect(d.removed).toBe(600)
    const mostradas = d.hunks.reduce((n, h) => n + h.lines.length, 0)
    expect(mostradas).toBeLessThanOrEqual(400)
  })
})

describe('detalhes que quebram diff caseiro', () => {
  it('lida com CRLF sem marcar o arquivo inteiro como alterado', () => {
    const d = fileDiff({ path: 'crlf.ts', before: 'a\r\nb\r\nc\r\n', after: 'a\r\nB\r\nc\r\n' })
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
  })

  it('lida com arquivo sem quebra de linha no fim', () => {
    const d = fileDiff({ path: 'sem-fim.ts', before: 'a\nb', after: 'a\nB' })
    expect(d.added).toBe(1)
    expect(d.removed).toBe(1)
    // O marcador "\ No newline at end of file" não vira linha de conteúdo
    const textos = d.hunks.flatMap(h => h.lines.map(l => l.text))
    expect(textos.some(t => t.includes('No newline'))).toBe(false)
  })

  it('arquivo vazio para preenchido', () => {
    const d = fileDiff({ path: 'vazio.ts', before: '', after: text('a') })
    expect(d.added).toBe(1)
    expect(d.removed).toBe(0)
  })
})
