---
name: producao-de-video
description: Produz vídeos completos (roteiro, cenas, narração, legendas, montagem) usando ffmpeg e imagens locais.
tags: [video, ffmpeg, roteiro, narracao, reels]
updated: 2026-11-14
---

# Produção de vídeo

Use quando o pedido envolver criar vídeo, reels, shorts, apresentação narrada ou storyboard.

## Fluxo obrigatório

1. **Briefing** — formato (16:9, 9:16, 1:1), duração, público, tom, trilha.
2. **Roteiro** — cena a cena: narração + descrição visual + duração em segundos. Salve em `output/roteiro.md`.
3. **Assets** — gere ou colete uma imagem por cena em `output/cenas/cena-01.png`. Nunca invente que gerou: se não houver gerador de imagem disponível, avise e use placeholders nomeados.
4. **Narração** — se houver TTS/áudio disponível, gere `output/narracao.mp3`; caso contrário, entregue o texto com marcações de tempo.
5. **Montagem com ffmpeg** — verifique se existe com `ffmpeg -version`. Slide por cena:

   ```
   ffmpeg -y -loop 1 -i cenas/cena-01.png -t 4 -vf "scale=1080:1920,zoompan=z='min(zoom+0.0008,1.08)':d=100,setsar=1" cena-01.mp4
   ```

   Concatene (`concat` demuxer com lista de arquivos) e finalize com áudio:

   ```
   ffmpeg -y -f concat -safe 0 -i lista.txt -i narracao.mp3 -c:v libx264 -pix_fmt yuv420p -c:a aac -shortest output/video-final.mp4
   ```

6. **Legendas** — gere `.srt` com tempos reais e embuta com `-vf subtitles=legendas.srt`.
7. **Verificação** — rode `ffprobe -v error -show_format -show_streams output/video-final.mp4` e confirme duração, codec e resolução. Só declare pronto depois disso.

## Regras

- Sempre execute os comandos e mostre exit code + saída. Não descreva o comando sem executar quando o pedido for de entrega.
- Se o ffmpeg não existir, instale (`winget install Gyan.FFmpeg` ou via gerenciador disponível) ou entregue o pacote de assets + comandos prontos, deixando claro o que faltou.
- Entregue junto: roteiro, lista de cenas, legendas e arquivo final.
