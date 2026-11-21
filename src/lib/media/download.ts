/**
 * Content-Disposition de um arquivo baixado do Estúdio: o título com acentos ("Produção do café.mp4")
 * vai em filename* (RFC 5987) e um filename só ASCII fica de reserva. Antes os acentos eram apagados
 * ("Produo do caf.mp4").
 */
export function downloadDisposition(title: string, ext: string) {
  const clean = title.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'video'
  const ascii = clean.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w\- ]+/g, '').replace(/\s+/g, ' ').trim() || 'video'
  return `attachment; filename="${ascii}${ext}"; filename*=UTF-8''${encodeURIComponent(clean + ext)}`
}
