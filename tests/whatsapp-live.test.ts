import { describe, expect, it } from 'vitest'
import { extractMessageText, looksAcademic, messageToItem, toHubItem } from '@/lib/whatsapp/bridge'

describe('extractMessageText', () => {
  it('lê conversation (texto simples)', () => {
    expect(extractMessageText({ conversation: 'bom dia pessoal' })).toBe('bom dia pessoal')
  })
  it('lê extendedTextMessage (texto com formatação)', () => {
    expect(extractMessageText({ extendedTextMessage: { text: 'trabalho de BD *vale 2 pontos*' } })).toBe('trabalho de BD *vale 2 pontos*')
  })
  it('lê legenda de imagem', () => {
    expect(extractMessageText({ imageMessage: { caption: 'print da prova' } })).toBe('print da prova')
  })
  it('lê legenda de vídeo', () => {
    expect(extractMessageText({ videoMessage: { caption: 'aula gravada' } })).toBe('aula gravada')
  })
  it('lê documento com caption', () => {
    expect(extractMessageText({ documentMessage: { caption: 'atividade.pdf anexado' } })).toBe('atividade.pdf anexado')
  })
  it('lê reação', () => {
    expect(extractMessageText({ reactionMessage: { text: '✅' } })).toBe('✅')
  })
  it('devolve vazio quando não há texto utilizável', () => {
    expect(extractMessageText(undefined)).toBe('')
    expect(extractMessageText(null)).toBe('')
    expect(extractMessageText({})).toBe('')
    expect(extractMessageText({ audioMessage: {} })).toBe('')
  })
})

describe('messageToItem', () => {
  const msg = (over: Partial<{ fromMe: boolean; id: string; ts: number; participant: string }> = {}) => ({
    key: { remoteJid: '120363@g.us', fromMe: over.fromMe ?? false, id: over.id ?? 'ABC123', participant: over.participant ?? '5511987654321@s.whatsapp.net' },
    messageTimestamp: over.ts ?? 1794000000,
    message: { conversation: 'entrega até sexta' },
    pushName: 'Prof. Maria',
  })

  it('converte mensagem válida com timestamp e chave determinística', () => {
    const c = messageToItem(msg(), 'TI 4º semestre')
    expect(c).not.toBeNull()
    expect(c!.key).toBe('wa:120363@g.us:ABC123')
    expect(c!.at).toBe(1794000000 * 1000)
    expect(c!.author).toBe('Prof. Maria')
    expect(c!.text).toBe('entrega até sexta')
  })

  it('aceita Long timestamps (toNumber)', () => {
    const c = messageToItem({
      key: { remoteJid: '1@g.us', fromMe: false, id: 'X1' },
      messageTimestamp: { toNumber: () => 1794000000 } as never,
      message: { conversation: 'teste' },
      pushName: 'Aluno',
    }, 'Turma')
    expect(c!.at).toBe(1794000000 * 1000)
  })

  it('descarta mensagens sem texto', () => {
    expect(messageToItem({ key: { remoteJid: '1@g.us', fromMe: false, id: 'X' }, messageTimestamp: 1794000000, message: { audioMessage: {} }, pushName: 'Aluno' }, 'Turma')).toBeNull()
  })

  it('toHubItem gera um item completo do Hub', () => {
    const conv = messageToItem(msg(), 'TI 4º semestre')!
    const item = toHubItem(conv, 'TI 4º semestre', 1)
    expect(item.id).toBe('wa:120363@g.us:ABC123')
    expect(item.source).toBe('whatsapp')
    expect(item.kind).toBe('message')
    expect(item.origin.where).toBe('TI 4º semestre')
    expect(item.origin.author).toBe('Prof. Maria')
    expect(item.origin.at).toBe(1794000000 * 1000)
  })
})

describe('looksAcademic', () => {
  it('reconhece mensagens acadêmicas típicas', () => {
    const exemplos = [
      'pessoal, a prova de algoritmos ficou pra segunda',
      'entrega do trabalho de banco de dados até sexta',
      'boa tarde! aula de redes cancelada amanhã',
      'avisando: atividade valendo nota no portal',
      'quem ficou de entregar o relatório?',
      'frequência: faltou 5 vezes já',
    ]
    for (const t of exemplos) expect(looksAcademic(t), t).toBe(true)
  })
  it('não classifica conversa cotidiana como acadêmica', () => {
    const exemplos = [
      'bom dia pessoal, churrasco no sábado!',
      'alguém sabe de bar perto de casa?',
      'quem vai no jogo hoje?',
      'manda o link do vídeo que eu pediu',
    ]
    for (const t of exemplos) expect(looksAcademic(t), t).toBe(false)
  })
})
