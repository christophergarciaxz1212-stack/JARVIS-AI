# Instalação do JARVIS — do zero ao uso

## 1. Baixe

Na página **[Releases](../../releases/latest)**, escolha:

- **`JARVIS-AI-Setup-x.y.z.exe`** — instalador. Instala só para o seu usuário (não pede
  administrador), cria atalho na Área de Trabalho e no Menu Iniciar e aparece em
  *Configurações › Aplicativos* para desinstalar.
- **`JARVIS-Portable.zip`** — versão portátil. Clique com o botão direito → *Extrair tudo*,
  escolha uma pasta (ex.: `Documentos\JARVIS`) e abra **`JARVIS AI.exe`**.

## 2. Aviso do Windows (SmartScreen)

O JARVIS não tem um certificado pago de assinatura de código, então o Windows pode mostrar
**"O Windows protegeu seu PC"**. Clique em **Mais informações → Executar assim mesmo**.
Isso aparece uma vez só.

## 3. Primeira abertura

O **Assistente de Primeira Configuração** mede de verdade o seu computador: Windows, CPU,
RAM, disco, GPU, internet, Chrome/Edge e Ollama. O que faltar aparece com um botão
**Instalar** — nada é instalado sem o seu clique. **Pular por agora** adia para a próxima vez.

## 4. Conecte uma IA (obrigatório, grátis)

Clique em **🔑 Chaves** e cole pelo menos uma chave:

| Provedor | Onde pegar | Observação |
|---|---|---|
| Google Gemini | https://aistudio.google.com/app/apikey | entende imagens; voz |
| Groq | https://console.groq.com/keys | o mais rápido |
| OpenRouter | https://openrouter.ai/settings/keys | dezenas de modelos `:free` |
| NVIDIA NIM | https://build.nvidia.com/settings/api-keys | modelos grandes |

Use **Testar** ao lado de cada chave para confirmar. Em **Outros provedores** você
adiciona qualquer API compatível com OpenAI/Anthropic e busca os modelos dela.

## 5. Opcional

- **Modelos locais (sem internet):** instale o [Ollama](https://ollama.com) e rode
  `ollama pull llama3.2:3b` no terminal. O JARVIS detecta sozinho.
- **Vídeos:** precisam do Chrome ou do Edge instalados (o Edge já vem no Windows).

## Onde ficam seus dados

Tudo fica numa pasta `data/` no seu computador: chaves (`keys.json`), preferências,
conversas, vídeos, imagens e logs. Nada disso é enviado a ninguém além do provedor de IA
que você usar em cada conversa.

## Problemas comuns

| Sintoma | O que fazer |
|---|---|
| "Nenhuma IA conectada" | Cole ao menos uma chave em 🔑 Chaves. |
| Chave recusada | Gere uma nova no site do provedor e use **Testar**. |
| "Chrome ou Edge não encontrado" | Instale o Chrome (o assistente oferece o botão). |
| Uma IA parou de responder | Normal na cota grátis: o JARVIS troca de modelo sozinho; a cota volta no dia seguinte. |
| O antivírus bloqueou | Restaure o arquivo e adicione uma exceção — o app não é assinado digitalmente. |

## Atualizar

Baixe a versão nova e instale por cima (ou extraia o portátil na mesma pasta).
Seus dados em `data/` são mantidos.

## Desinstalar

Instalador: *Configurações › Aplicativos › JARVIS AI › Desinstalar*.
Portátil: feche o app e apague a pasta.
