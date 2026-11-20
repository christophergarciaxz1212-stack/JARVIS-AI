import { describe, it, expect } from 'vitest'
import { downloadDisposition } from '@/lib/video/download'

describe('nome do arquivo baixado no Estúdio', () => {
  it('mantém os acentos em filename* e deixa um filename ASCII de reserva', () => {
    const h = downloadDisposition('Produção do café', '.mp4')
    expect(h).toContain('filename="Producao do cafe.mp4"')
    expect(h).toContain(`filename*=UTF-8''${encodeURIComponent('Produção do café.mp4')}`)
  })
  it('remove caracteres proibidos em nomes de arquivo e aspas que quebrariam o cabeçalho', () => {
    const h = downloadDisposition('IA: o "futuro"/hoje?', '.srt')
    expect(h).toContain('filename="IA o futuro hoje.srt"')
    expect(decodeURIComponent(h.split("UTF-8''")[1])).toBe('IA o futuro hoje.srt')
  })
  it('título vazio vira "video"', () => {
    expect(downloadDisposition('  ', '.vtt')).toContain('filename="video.vtt"')
  })
})
