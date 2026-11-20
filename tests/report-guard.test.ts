import { describe, expect, it } from 'vitest'
import { guardFileClaims } from '@/lib/agents/orchestrator'

const fake = '## FEITO\n- Criação do README.md descrevendo os arquivos e diretórios na raiz do projeto.\n## VERIFICADO\nNada verificado por ferramenta\n## PENDENTE\nNenhuma pendência'

describe('relatório final não afirma gravação que não aconteceu', () => {
  it('sem alterações, "criação do README.md" em FEITO vira aviso em PENDENTE (caso real da bateria de 19/11)', () => {
    const out = guardFileClaims(fake, 0)
    expect(out).toMatch(/## PENDENTE\n- ⚠️ Nenhum arquivo foi gravado/)
    expect(out).not.toMatch(/Nenhuma pendência/)
  })
  it('com alterações reais, ou sem afirmar arquivo, nada muda', () => {
    expect(guardFileClaims(fake, 1)).toBe(fake)
    const answer = '## FEITO\n- Comando node --version executado: v26.13.1\n## VERIFICADO\n- saída do comando\n## PENDENTE\nNenhuma pendência'
    expect(guardFileClaims(answer, 0)).toBe(answer)
  })
})
