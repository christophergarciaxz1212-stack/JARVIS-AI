import { describe, expect, it } from 'vitest'
import {
  forgetProjectFiles, listProjectFiles, readProjectFile, scorePath, searchProjectFiles,
} from '@/lib/agents/projectFiles'
import { tempProject } from './helpers'

const projeto = () => tempProject({
  'package.json': '{"name":"demo"}',
  'README.md': '# Demo\n',
  'src/lib/router.ts': 'export const router = 1\n',
  'src/lib/utils.ts': 'export const util = 2\n',
  'src/components/Botao.tsx': 'export default function Botao() {}\n',
  'node_modules/lixo/index.js': 'module.exports = {}\n',
  '.git/config': '[core]\n',
  'docs/guia.md': '# Guia\n',
})

describe('varredura do projeto', () => {
  it('lista os arquivos e ignora node_modules e pastas ocultas', () => {
    const dir = projeto()
    const files = listProjectFiles(dir)
    expect(files).toContain('package.json')
    expect(files).toContain('src/lib/router.ts')
    expect(files).toContain('docs/guia.md')
    expect(files.some(f => f.includes('node_modules'))).toBe(false)
    expect(files.some(f => f.includes('.git'))).toBe(false)
  })

  it('usa barra normal, mesmo no Windows', () => {
    for (const f of listProjectFiles(projeto())) expect(f).not.toContain('\\')
  })

  it('pasta inexistente devolve lista vazia em vez de quebrar', () => {
    expect(listProjectFiles('C:\\pasta\\que\\nao\\existe')).toEqual([])
    expect(listProjectFiles('')).toEqual([])
  })
})

describe('pontuação da busca', () => {
  it('prefere nome do arquivo começando com o termo', () => {
    const inicio = scorePath('src/lib/router.ts', 'rout')!
    const meio = scorePath('src/lib/myrouter.ts', 'rout')!
    expect(inicio).toBeLessThan(meio)
  })

  it('caminho conta menos que nome', () => {
    const nome = scorePath('src/lib/utils.ts', 'utils')!
    const caminho = scorePath('src/utils/a.ts', 'utils')!
    expect(nome).toBeLessThan(caminho)
  })

  it('aceita letras na ordem, sem precisar estarem juntas', () => {
    expect(scorePath('src/lib/router.ts', 'slr')).not.toBeNull()
    expect(scorePath('src/lib/router.ts', 'zzz')).toBeNull()
  })

  it('ignora acento e caixa', () => {
    expect(scorePath('src/components/Botao.tsx', 'BOTAO')).not.toBeNull()
    expect(scorePath('src/components/Seção.tsx', 'secao')).not.toBeNull()
  })

  it('termo vazio aceita tudo', () => {
    expect(scorePath('qualquer.ts', '')).toBe(0)
  })
})

describe('busca para o @', () => {
  it('acha pelo nome do arquivo', () => {
    const dir = projeto()
    const hits = searchProjectFiles(dir, 'router')
    expect(hits[0].path).toBe('src/lib/router.ts')
    expect(hits[0].name).toBe('router.ts')
  })

  it('acha pelo caminho', () => {
    const paths = searchProjectFiles(projeto(), 'components').map(h => h.path)
    expect(paths).toContain('src/components/Botao.tsx')
  })

  it('respeita o limite pedido', () => {
    expect(searchProjectFiles(projeto(), '', 3)).toHaveLength(3)
  })

  it('termo sem correspondência devolve nada', () => {
    expect(searchProjectFiles(projeto(), 'xyzabc123')).toEqual([])
  })
})

describe('leitura do arquivo citado', () => {
  it('lê o conteúdo de um arquivo do projeto', () => {
    const dir = projeto()
    const r = readProjectFile(dir, 'src/lib/router.ts')
    expect(r.text).toContain('export const router')
    expect(r.path).toBe('src/lib/router.ts')
    expect(r.truncated).toBe(false)
  })

  it('recusa caminho que sai do projeto', () => {
    const dir = projeto()
    expect(() => readProjectFile(dir, '../../segredo.txt')).toThrow()
  })

  it('recusa extensão binária', () => {
    const dir = tempProject({ 'logo.png': 'conteudo' })
    expect(() => readProjectFile(dir, 'logo.png')).toThrow('não é um arquivo de texto')
  })

  it('recusa arquivo com bytes binários mesmo com extensão de texto', () => {
    const dir = tempProject({ 'estranho.txt': 'abc\0def' })
    expect(() => readProjectFile(dir, 'estranho.txt')).toThrow('binário')
  })

  it('arquivo inexistente levanta erro claro', () => {
    expect(() => readProjectFile(projeto(), 'nao-existe.ts')).toThrow()
  })
})

describe('cache da varredura', () => {
  it('esquecer a varredura faz enxergar arquivo criado depois', async () => {
    const fs = await import('fs')
    const path = await import('path')
    const dir = projeto()
    expect(listProjectFiles(dir)).not.toContain('novo.ts')

    fs.writeFileSync(path.join(dir, 'novo.ts'), 'export const x = 1\n')
    forgetProjectFiles(dir)
    expect(listProjectFiles(dir)).toContain('novo.ts')
  })
})
