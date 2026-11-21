import { afterEach, describe, expect, it } from 'vitest'
import {
  closeAllTerminals, closeTerminal, createTerminal, getTerminal, listTerminals, writeTerminal,
} from '@/lib/terminal'

afterEach(() => closeAllTerminals())

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/**
 * Espera o texto aparecer na saída da sessão.
 * Ignora os blocos 'comando' de propósito: eles são o eco do que foi digitado,
 * e casar com o eco faria o teste passar sem o programa ter respondido nada.
 */
async function esperaSaida(id: string, procura: RegExp, timeoutMs = 20_000) {
  const lida = () => getTerminal(id)!.history().filter(c => c.kind !== 'comando').map(c => c.text).join('')
  const fim = Date.now() + timeoutMs
  while (Date.now() < fim) {
    const texto = lida()
    if (procura.test(texto)) return texto
    await sleep(150)
  }
  throw new Error(`Não apareceu ${procura} em ${timeoutMs}ms. Saída:\n${lida()}`)
}

describe('ciclo de vida da sessão', () => {
  it('cria, lista e encerra', () => {
    const t = createTerminal({ title: 'Teste' })
    expect(t.alive).toBe(true)
    expect(t.shell).toBe('powershell')
    expect(t.title).toBe('Teste')

    expect(listTerminals().map(s => s.id)).toContain(t.id)
    expect(closeTerminal(t.id)).toBe(true)
    expect(listTerminals().map(s => s.id)).not.toContain(t.id)
    expect(closeTerminal(t.id)).toBe(false)
  })

  it('abre várias sessões independentes', () => {
    const a = createTerminal({ title: 'A' })
    const b = createTerminal({ title: 'B' })
    expect(a.id).not.toBe(b.id)
    expect(listTerminals()).toHaveLength(2)
  })

  it('respeita o limite de sessões abertas', () => {
    for (let i = 0; i < 8; i++) createTerminal()
    expect(() => createTerminal()).toThrow('Limite de 8 terminais')
  })
})

describe('o shell fica vivo entre comandos', () => {
  it('mantém a pasta depois de um cd', async () => {
    const t = createTerminal()
    writeTerminal(t.id, 'Set-Location -LiteralPath $env:WINDIR')
    writeTerminal(t.id, 'Write-Output "AQUI:$((Get-Location).Path)"')
    const saida = await esperaSaida(t.id, /AQUI:/i)
    expect(saida.toUpperCase()).toContain('WINDOWS')
  }, 40_000)

  it('mantém variáveis definidas num comando anterior', async () => {
    const t = createTerminal()
    writeTerminal(t.id, '$umNumero = 4242')
    writeTerminal(t.id, 'Write-Output "VALOR:$umNumero"')
    expect(await esperaSaida(t.id, /VALOR:4242/)).toContain('VALOR:4242')
  }, 40_000)
})

describe('entrada interativa', () => {
  it('responde a um programa que faz uma pergunta', async () => {
    const t = createTerminal()
    writeTerminal(t.id, '$resposta = Read-Host "Qual o nome"')
    await sleep(900)
    // A mesma função envia a resposta: para o shell, é só mais uma linha
    writeTerminal(t.id, 'JARVIS')
    writeTerminal(t.id, 'Write-Output "RECEBI:$resposta"')
    expect(await esperaSaida(t.id, /RECEBI:JARVIS/)).toContain('RECEBI:JARVIS')
  }, 40_000)
})

describe('saída', () => {
  it('guarda o comando digitado junto da resposta', async () => {
    const t = createTerminal()
    writeTerminal(t.id, 'Write-Output "ola"')
    await esperaSaida(t.id, /ola/)
    const tipos = getTerminal(t.id)!.history().map(c => c.kind)
    expect(tipos).toContain('comando')
    expect(tipos).toContain('saida')
  }, 40_000)

  it('separa erro de saída normal', async () => {
    const t = createTerminal()
    writeTerminal(t.id, 'Get-Item C:\\pasta\\que\\nao\\existe\\mesmo')
    await sleep(2500)
    const erros = getTerminal(t.id)!.history().filter(c => c.kind === 'erro')
    expect(erros.length).toBeGreaterThan(0)
  }, 40_000)

  it('history(after) devolve só o que é novo', async () => {
    const t = createTerminal()
    writeTerminal(t.id, 'Write-Output "primeiro"')
    await esperaSaida(t.id, /primeiro/)
    const ate = getTerminal(t.id)!.history().slice(-1)[0].id

    writeTerminal(t.id, 'Write-Output "segundo"')
    await esperaSaida(t.id, /segundo/)
    const novos = getTerminal(t.id)!.history(ate).map(c => c.text).join('')
    expect(novos).toContain('segundo')
    expect(novos).not.toContain('primeiro')
  }, 40_000)

  it('avisa os inscritos em tempo real', async () => {
    const t = createTerminal()
    const vistos: string[] = []
    const parar = getTerminal(t.id)!.subscribe(c => vistos.push(c.text))
    writeTerminal(t.id, 'Write-Output "ao-vivo"')
    await esperaSaida(t.id, /ao-vivo/)
    parar()
    expect(vistos.join('')).toContain('ao-vivo')
  }, 40_000)
})

describe('segurança', () => {
  it('recusa o que destrói a máquina, mesmo pelo terminal', () => {
    const t = createTerminal()
    expect(() => writeTerminal(t.id, 'format c:')).toThrow('bloqueado por segurança')
    expect(() => writeTerminal(t.id, 'shutdown /s')).toThrow('bloqueado por segurança')
  })

  it('permite comandos normais, incluindo apagar arquivo (é um terminal do usuário)', () => {
    const t = createTerminal()
    expect(() => writeTerminal(t.id, 'Remove-Item teste.txt')).not.toThrow()
    expect(() => writeTerminal(t.id, 'npm test')).not.toThrow()
  })

  it('recusa linha absurdamente longa', () => {
    const t = createTerminal()
    expect(() => writeTerminal(t.id, 'x'.repeat(9000))).toThrow('longa demais')
  })

  it('não vaza chaves de API para o shell', async () => {
    process.env.JARVIS_TESTE_SECRET_KEY = 'valor-secreto-123'
    const t = createTerminal()
    writeTerminal(t.id, 'Write-Output "CHAVE:[$env:JARVIS_TESTE_SECRET_KEY]"')
    const saida = await esperaSaida(t.id, /CHAVE:/)
    expect(saida).not.toContain('valor-secreto-123')
    delete process.env.JARVIS_TESTE_SECRET_KEY
  }, 40_000)

  it('escrever numa sessão inexistente dá erro claro', () => {
    expect(() => writeTerminal('nao-existe', 'ls')).toThrow('Terminal não encontrado')
  })
})
