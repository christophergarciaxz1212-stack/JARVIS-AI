# JARVIS AI

**Seu agente de IA pessoal para Windows** — conversa com dezenas de modelos de IA
**gratuitos**, executa tarefas no seu PC, produz vídeos, projeta redes e monitora
sua infraestrutura. Tudo roda no seu computador; suas chaves e conversas não saem dele.

### ⬇️ [Baixar a versão mais recente](../../releases/latest)

| Arquivo | Para quem |
|---|---|
| `JARVIS-AI-Setup-x.y.z.exe` | Instalador: Avançar → Instalar → Concluir. Cria atalhos e desinstalador. |
| `JARVIS-Portable.zip` | Sem instalação: extraia e abra `JARVIS AI.exe`. Funciona até onde instaladores são bloqueados. |

---

## O que ele faz

- 💬 **Chat com IA grátis** — Google Gemini, Groq, OpenRouter, NVIDIA, Mistral e modelos
  locais (Ollama/LM Studio). Modo automático escolhe o melhor modelo para cada tarefa
  e troca sozinho quando um provedor falha ou esgota a cota.
- 🧩 **Qualquer provedor novo** — cadastre qualquer API compatível com OpenAI ou Anthropic
  (Cerebras, Hugging Face, vLLM, LiteLLM…) e os modelos aparecem sozinhos.
- 📎 **Contexto para a IA** — arraste PDFs, documentos Word/Excel/PowerPoint, planilhas e
  código para o chat; a IA usa o material na conversa inteira.
- 🤖 **Agente** — executa de verdade: cria e edita arquivos, roda comandos, programa e testa.
- 🎬 **Estúdio de Vídeo** com 3 modelos: **Vídeos** (verticais animados no estilo dos
  vídeos de tecnologia do TikTok: passos, notícia, dados ou analogia), **Comercial** (app
  ou produto) e **Publicitário** (filme de campanha). Narração com teste de voz, efeitos
  especiais, legendas e revisão automática dos quadros; som limpo, só voz e efeitos.
- 📍 **Empresas e comércios próximos** — pergunte "quais padarias tem perto da Savassi,
  BH" ou "empresas sem site no centro de Campinas": telefone, WhatsApp, site, horário,
  nota de oportunidade (quem ainda não tem site primeiro) e planilha Excel. Usa os
  dados abertos do OpenStreetMap.
- 🌐 **Redes** — projeta topologias com diagrama editável, valida endereçamento/VLANs/laços,
  gera configurações, exporta para Containerlab/EVE-NG; calculadora IP/VLSM e
  diagnóstico real (ping, DNS, porta, traceroute) direto no chat.
- 🖥️ **Infraestrutura** — monitores, incidentes, servidores via SSH, Docker, backups.
- 🔒 **Privado** — chaves de API ficam só no seu PC; nada é enviado a terceiros além do
  provedor de IA que você escolher.

## Requisitos

- Windows 10 (64 bits) ou 11
- 4 GB de RAM (8 GB recomendado) e ~2 GB livres
- Internet para as IAs na nuvem (opcional com Ollama)
- Google Chrome ou Microsoft Edge (o Edge já vem no Windows)

## Instalação rápida

1. Baixe o instalador ou o `.zip` portátil em **[Releases](../../releases/latest)**.
2. Se o Windows mostrar *"O Windows protegeu seu PC"*, clique em **Mais informações →
   Executar assim mesmo** (aviso normal para apps sem certificado pago de assinatura).
3. Abra o JARVIS. O **Assistente de Primeira Configuração** verifica o seu PC.
4. Clique em **🔑 Chaves** e cole pelo menos uma chave gratuita (veja abaixo).

Passo a passo completo, com solução de problemas: **[INSTALACAO.md](INSTALACAO.md)**.

## Chaves gratuitas (escolha pelo menos uma)

| Provedor | Onde pegar |
|---|---|
| Google Gemini | https://aistudio.google.com/app/apikey |
| Groq | https://console.groq.com/keys |
| OpenRouter | https://openrouter.ai/settings/keys |
| NVIDIA NIM | https://build.nvidia.com/settings/api-keys |

Sem internet? Instale o [Ollama](https://ollama.com), rode `ollama pull llama3.2:3b`
e o JARVIS usa o modelo local sozinho.

## Experimente pedir

- "crie uma topologia de rede para uma empresa com matriz e filial"
- "faça o vlsm de 192.168.10.0/24 para vendas 60 hosts, rh 25 e ti 12"
- "crie um vídeo de 30 segundos: 5 ferramentas de IA para programadores"
- "crie um comercial do meu app de finanças" · "filme publicitário da minha cafeteria"
- "quais academias tem perto de Moema, São Paulo num raio de 1 km"
- "pinga 8.8.8.8" · "o site exemplo.com caiu?"
- arraste um PDF para o chat e pergunte sobre ele

---

© Todos os direitos reservados. O download é gratuito para uso pessoal; o código-fonte
não é distribuído. Veja [LICENCA.md](LICENCA.md).

