# Como instalar o JARVIS em outro computador (guia para quem vai enviar)

Você tem três artefatos prontos para distribuir na pasta `release/` (ignorada pelo git):

| Arquivo | Tamanho | Para quem |
|---|---|---|
| `JARVIS-Portable.zip` | ~305 MB | **Recomendado**: funciona em qualquer máquina, sem instalação |
| `JARVIS-Portable/` | ~1,05 GB | Mesmo conteúdo do zip, já descompactado |
| `JARVIS-Setup-1.1.0.exe` | ~219 MB | Experiência profissional: instalador com atalhos e desinstalador |

**Verificação honesta:** o portátil foi testado nesta máquina de ponta a ponta.
O instalador compila corretamente (makensis, CRC válido), mas a máquina de
desenvolvimento bloqueia a execução de executáveis recém-compilados sem assinatura —
estas são as duas opções, e a primeira é a garantida.

Envie **um** deles (não precisa dos três). Não envie a pasta `release-staging/` nem o
repositório — são 1 GB+ de arquivos de desenvolvimento.

## O que a pessoa precisa no computador

- **Windows 10 ou 11, 64 bits** (x64). Não testado em macOS/Linux.
- **Chrome ou Edge** (já vêm com o Windows) — usados para renderizar vídeos.
- **Internet** para as IAs na nuvem (Gemini, Groq, OpenRouter — todas têm plano gratuito).
- **4 GB de RAM** (8 GB recomendado), **2 GB livres** de disco (5 GB+ se quiser vídeos e imagens).
- **Não precisa instalar Node, Git, Python nem FFmpeg** — o JARVIS é autossuficiente.
- **Opcional**: [Ollama](https://ollama.com) para modelos 100% locais e offline.

## Passo a passo — Instalador

1. Baixe/receba o `JARVIS-Setup-1.1.0.exe`.
2. **Duplo clique** nele.
3. O Windows vai mostrar **"O Windows protegeu seu PC"** (porque o app não tem
   assinatura digital paga — custa centenas de dólares por ano):
   **Mais informações → Executar assim mesmo**. É seguro: o arquivo é o que você
   mesmo gerou; a mensagem aparece para qualquer app não assinado.
   - Se o antivírus reclamar de qualquer forma, escolha **Mais detalhes → Manter/Executar**.
4. No assistente: **Avançar** → escolha a pasta (padrão `%LOCALAPPDATA%\Programs\JARVIS AI`) → **Instalar** → **Concluir**.
5. Abra pelo atalho **JARVIS AI** na área de trabalho ou no menu Iniciar.
6. **Primeira execução**: o assistente do JARVIS mede o computador de verdade e
   mostra o que está pronto ou faltando. Nada é instalado sem o clique dela.
7. **Chaves de IA** (obrigatório para o chat): clique em **🔑 Chaves de API** e
   cole uma chave gratuita — Gemini (aistudio.google.com/apikey), Groq
   (console.groq.com/keys), OpenRouter (openrouter.ai/keys) ou NVIDIA
   (build.nvidia.com). Todas têm tier gratuito.

## Passo a passo — Portátil (sem instalar nada)

1. Baixe o `JARVIS-Portable.zip` e extraia (botão direito → Extrair tudo) para uma
   pasta de sua escolha (ex.: `C:\JARVIS`).
2. Entre na pasta extraída e execute **`JARVIS AI.exe`**.
3. Mais informações → Executar assim mesmo se o Windows pedir.
4. Mesmo primeiro uso do instalador (seções 6–7 acima).
5. Para desinstalar: apague a pasta. Nada fica no registro.

## Desinstalação

- **Instalador**: Painel de Controle → Aplicativos → "JARVIS AI" → Desinstalar
  (ou atalho "Desinstalar JARVIS AI" no menu Iniciar).
- Os dados (conversas, chaves, projetos) ficam em `Documentos\JARVIS\data` e **não
  são apagados** na desinstalação. Para apagar tudo: apague também essa pasta.

## O que cada amigo deve saber

- **Onde ficam os dados**: tudo em `Documentos\JARVIS\data` (chaves, preferências,
  vídeos produzidos). Cada computador tem os seus — **as chaves não viajam com o app**.
- **Chaves gratuitas**: uma chave Gemini/Groq/OpenRouter resolve; cada pessoa
  cria a sua (as suas chaves pessoais NÃO vão junto no pacote — e não devem ir).
- **Vídeos**: funcionam com qualquer PC Windows 10/11 com Chrome/Edge — geração de
  imagens é feita pelo Pollinations (1 imagem a cada 45s) ou pelo Gemini (se a cota
  de imagens estiver ativa na chave dela).
- **WhatsApp oficial**: opcional; exige criar um app no Meta for Developers e
  colar Phone Number ID + token permanente (o assistente de diagnóstico guia cada
  passo — ver `GUIA-WHATSAPP-META.md`).

## Por que o Windows avisa na primeira vez?

SmartScreen bloqueia qualquer executável baixado da internet sem reputação ou sem
assinatura. O JARVIS funciona igual depois que a pessoa clica "Executar assim
mesmo" uma vez — é exatamente o que acontece com qualquer app novo independente.
A única forma de remover o aviso é assinar o instalador com um certificado
(EV/OV, ~US$ 200–500/ano); o código-fonte é auditável por qualquer pessoa.

## Solução de problemas rápidos

| Sintoma | O que fazer |
|---|---|
| "O Windows protegeu seu PC" | Mais informações → Executar assim mesmo |
| App não abre (janela some) | Confira se antivírus não colocou em quarentena; a pasta foi extraída? |
| "Nenhuma IA conectada" | Configure 1 chave em 🔑 Chaves de API (passo 7) |
| Porta 3001/3002 ocupada | O app escolhe a próxima porta livre sozinho |
| Vídeo não gera | Pollinations: 1 imagem/45s (aguarde) ou cota Gemini |
| Sem internet | Chat na nuvem falha; com Ollama instalado, modelos locais funcionam offline |
| Desinstalar mantém dados | Normal: `Documentos\JARVIS\data` é preservado de propósito |

## Atualização

Hoje não há autoupdate de versão entre releases; para atualizar, baixe o novo
`JARVIS-Setup-1.1.0.exe` (ou zip) sobre a instalação atual — os dados em
`Documentos\JARVIS\data` são preservados.

> Sobre o instalador: ele é gerado pelo `scripts/installer.nsi` (makensis) com a
> pasta produzida pelo `scripts/prepare-dist.mjs` + `electron-builder --dir`.
> Em máquinas de terceiros ele deve funcionar normalmente (é o stack NSIS de
> milhões de apps). Nesta máquina de desenvolvimento não deu para executá-lo —
> a política do sistema encerra qualquer instalador recém-compilado sem assinatura.
> Se quiser remover o aviso do SmartScreen em qualquer máquina, assine o
> instalador com um certificado EV/OV.
