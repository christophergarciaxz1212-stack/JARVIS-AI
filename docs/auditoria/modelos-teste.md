# Teste real de todos os modelos gratuitos — 16/11/2026

Cada modelo recebeu "Responda apenas: ok" pela própria API do JARVIS (`POST /api/models`); as chaves nunca saíram do servidor.
Os modelos locais incluem o tempo de carregar o modelo na GPU (GTX 1660 SUPER, 6 GB): só um cabe por vez.

**45 modelos testados · 28 funcionam · 17 falharam.** Os pagos (OpenAI, Anthropic, DeepSeek e 402 do OpenRouter) não foram chamados: foram removidos, e testá-los gastaria créditos.

| Modelo | Resultado | Tempo | Detalhe |
|---|---|---|---|
| `groq\|qwen/qwen3.8-27b` | funciona | 0,3 s |  |
| `groq\|allam-2-7b` | funciona | 0,4 s |  |
| `openrouter\|cohere/north-mini-code:free` | funciona | 0,7 s |  |
| `openrouter\|nvidia/nemotron-3.5-super-vl:free` | funciona | 0,7 s |  |
| `groq\|openai/gpt-oss-20b` | funciona | 0,7 s |  |
| `groq\|openai/gpt-oss-120b` | funciona | 0,9 s |  |
| `openrouter\|nvidia/nemotron-3.5-lightning:free` | funciona | 0,9 s |  |
| `openrouter\|dots-studio/dots-3-note-preview:free` | funciona | 1,0 s |  |
| `openrouter\|nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free` | funciona | 1,0 s |  |
| `openrouter\|liquid/lfm-3-1.7b:free` | funciona | 1,2 s |  |
| `gemini\|gemini-3.1-flash-lite` | funciona | 1,3 s |  |
| `openrouter\|baidu/ernie-5.5-flash-preview:free` | funciona | 1,4 s |  |
| `gemini\|gemini-3.5-flash` | funciona | 1,4 s |  |
| `gemini\|gemini-3-flash-preview` | funciona | 1,4 s |  |
| `openrouter\|particle-ai/particle-1:free` | funciona | 1,5 s |  |
| `openrouter\|nvidia/nemotron-3-ultra-550b-a55b:free` | funciona | 1,6 s |  |
| `gemini\|gemini-3.1-flash-lite-preview` | funciona | 1,6 s |  |
| `gemini\|gemini-3.6-flash` | funciona | 2,2 s |  |
| `openrouter\|openrouter/free` | funciona | 2,2 s |  |
| `openrouter\|recursive/flint-v1.0:free` | funciona | 2,6 s |  |
| `openrouter\|inclusionai/ling-3.2-flash:free` | funciona | 5,8 s |  |
| `ollama\|gemma3:4b` | funciona | 9,9 s |  |
| `gemini\|gemini-3.5-flash-lite` | funciona | 10,8 s |  |
| `ollama\|llama3.2:3b` | funciona | 12,4 s |  |
| `gemini\|gemini-flash-lite-latest` | funciona | 13,3 s |  |
| `gemini\|gemini-4-hydrogen` | funciona | 15,1 s |  |
| `ollama\|qwen2.5-coder:7b` | funciona | 24,8 s |  |
| `ollama\|qwen3:4b` | funciona | 95,3 s |  |
| `openrouter\|google/gemma-4-26b-a4b-it:free` | limite temporário do provedor | 0,4 s | 429 Provider returned error |
| `gemini\|gemini-omni-flash-preview` | sem cota gratuita (oculto) | 0,6 s | [429 ] You exceeded your current quota, please check your plan and billin |
| `gemini\|gemini-2.5-flash-lite` | aposentado (oculto) | 0,6 s | [404 ] This model models/gemini-2.5-flash-lite is no longer available to new |
| `gemini\|gemini-4-carbon` | sem cota gratuita (oculto) | 0,6 s | [429 ] You exceeded your current quota, please check your plan and billing details. |
| `gemini\|gemini-2.5-flash` | aposentado (oculto) | 0,7 s | [404 ] This model models/gemini-2.5-flash is no longer available to new users. Ple |
| `gemini\|gemini-4-argon` | sem cota gratuita (oculto) | 0,7 s | [429 ] You exceeded your current quota, please check your plan and billing details. |
| `gemini\|gemini-pro-latest` | sem cota gratuita (oculto) | 0,8 s | [429 ] You exceeded your current quota, please check your plan and billing detail |
| `openrouter\|thinkingmachines/inkling-2-small:free` | bloqueado p/ apps (oculto) | 0,9 s | 403 thinkingmachines/inkling-2-small:free is only available on agentic harnesses. Try plugging it into a codin |
| `gemini\|gemini-omni-1.1-flash` | sem cota gratuita (oculto) | 1,0 s | [429 ] You exceeded your current quota, please check your plan and billing de |
| `openrouter\|google/gemma-4-31b-it:free` | limite temporário do provedor | 1,1 s | 429 Provider returned error |
| `gemini\|gemini-3.1-pro-preview` | sem cota gratuita (oculto) | 1,3 s | [429 ] You exceeded your current quota, please check your plan and billing d |
| `gemini\|gemini-2.5-pro` | aposentado (oculto) | 1,4 s | [404 ] This model models/gemini-2.5-pro is no longer available to new users. Please |
| `gemini\|gemini-omni-1.2-flash` | sem cota gratuita (oculto) | 2,2 s | [429 ] You exceeded your current quota, please check your plan and billing de |
| `gemini\|gemini-3.7-flash` | sobrecarga temporária | 3,8 s | [503 ] This model is currently experiencing high demand. Spikes in demand are usua |
| `gemini\|gemini-flash-latest` | sobrecarga temporária | 6,6 s | [503 ] This model is currently experiencing high demand. Spikes in demand are u |
| `ollama\|deepseek-r1:8b` | lento demais nesta GPU | 120,0 s | The operation was aborted due to timeout |
| `gemini\|gemini-3.8-flash` | lento demais nesta GPU | 120,0 s | This operation was aborted |
