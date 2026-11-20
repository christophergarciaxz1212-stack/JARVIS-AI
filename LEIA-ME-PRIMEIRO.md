# JARVIS — como rodar a partir do código-fonte

Este pacote tem **só o código** do JARVIS. Ele não traz chaves de API, conversas,
memória nem dados de quem enviou: cada pessoa configura as próprias.

## 1. Instale o que falta (uma vez só)

| Programa | Para quê | Onde baixar |
|---|---|---|
| **Node.js 20 ou mais novo (LTS)** | roda o JARVIS | https://nodejs.org (botão "LTS") |
| **Google Chrome** ou **Microsoft Edge** | interface e render de vídeos | o Edge já vem no Windows |
| Ollama *(opcional)* | modelos de IA locais, sem internet | https://ollama.com |

Depois de instalar o Node.js, feche e abra de novo qualquer janela de terminal.

## 2. Abra o JARVIS

1. Extraia o .zip numa pasta, por exemplo `Documentos\JARVIS`.
2. Dê dois cliques em **`start.bat`**.
   - Na **primeira vez** ele instala as dependências (`npm install`). Leva alguns
     minutos e baixa cerca de 1 GB. Deixe a janela preta terminar.
   - Depois ele sobe o servidor e abre o JARVIS numa janela própria
     (ou no navegador, em http://127.0.0.1:3001).

Pelo terminal, o equivalente é:

```bash
npm install
npm run dev
```

e abrir http://127.0.0.1:3001.

## 3. Conecte uma IA (2 minutos, grátis)

No JARVIS, clique em **🔑 Chaves** e cole pelo menos uma chave gratuita:

- **Google Gemini** — https://aistudio.google.com/app/apikey
- **Groq** — https://console.groq.com/keys
- **OpenRouter** — https://openrouter.ai/settings/keys
- **NVIDIA NIM** — https://build.nvidia.com/settings/api-keys

As chaves ficam só no seu computador (`data/keys.json`). Também dá para usar
`.env.local`, copiando o modelo `.env.local.example`.

Na mesma janela, em **Outros provedores**, dá para adicionar qualquer API
compatível com OpenAI/Anthropic (Cerebras, Hugging Face, um servidor local…).

## 4. O que experimentar

- Conversar e pedir código, arrastar arquivos/PDFs para o chat como contexto.
- "crie uma topologia de rede para uma empresa com matriz e filial"
- "calcule a sub-rede 192.168.10.77/26" · "pinga 8.8.8.8"
- "crie um vídeo de 30 segundos sobre energia solar" (Estúdio de Vídeo)
- `/infra` — painel de monitoramento, rede e servidores

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| `npm` não é reconhecido | Instale o Node.js e abra o terminal/`start.bat` de novo. |
| "Nenhuma IA conectada" | Cole ao menos uma chave em 🔑 Chaves. |
| Porta 3001 ocupada | Feche outro JARVIS aberto ou rode `stop-jarvis.bat`. |
| A primeira abertura demora | Normal: o modo de desenvolvimento compila as telas na primeira visita. |

Mais detalhes: `GUIA-INSTALACAO.md`, `GUIA-CONFIGURACAO.md` e os outros `GUIA-*.md`.
Testes: `npm test`.
