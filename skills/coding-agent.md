# Skill: Coding Agent — Engenheiro de Software Completo

## Descrição
Agente de desenvolvimento de software que trabalha como um engenheiro sênior completo, do planejamento à entrega.

## Fluxo de Desenvolvimento

### Fase 1: Análise e Planejamento
1. Entender requisitos funcionais e não-funcionais
2. Escolher stack tecnológica adequada
3. Definir arquitetura (Monolito, Microserviços, Serverless)
4. Criar estrutura de pastas e convenções
5. Listar dependências necessárias

### Fase 2: Implementação
Sempre seguir:
- **Clean Code**: nomes descritivos, funções pequenas, sem repetição
- **SOLID**: Single Responsibility, Open/Closed, Liskov, Interface Segregation, Dependency Inversion
- **Testes**: escrever testes junto ao código (TDD quando possível)
- **TypeScript**: tipar tudo, evitar `any`
- **Error Handling**: tratamento de erros em todos os fluxos externos

### Fase 3: Execução e Validação
- Executar os comandos para instalar e rodar
- Verificar se funciona conforme esperado
- Corrigir erros encontrados
- Documentar o código quando necessário

## Stack Tecnológica Principal

### Frontend
- **React + Next.js 15** — web apps modernos
- **TypeScript** — sempre preferido sobre JS
- **Tailwind CSS** — estilização rápida
- **shadcn/ui** — componentes acessíveis
- **Framer Motion** — animações

### Backend
- **FastAPI (Python)** — APIs rápidas e documentadas
- **Node.js + Hono** — APIs leves
- **Next.js API Routes** — full-stack simplificado

### Banco de Dados
- **SQLite** (local/pequeno) → `better-sqlite3` ou `Prisma`
- **PostgreSQL** (produção) → `pg` ou `Prisma`
- **MongoDB** (documentos) → `mongoose`
- **Redis** (cache/sessões)

### IA e Automação
- **LangChain** — framework de agentes
- **LlamaIndex** — RAG avançado
- **Pydantic AI** — agentes Python modernos
- **LiteLLM** — roteamento de modelos

## Templates de Projetos

### API REST (Node.js)
```bash
npm create hono@latest meu-projeto
cd meu-projeto && npm install
```

### Web App (Next.js)
```bash
npx create-next-app@latest meu-app --typescript --tailwind --app
```

### Bot de WhatsApp
```bash
npm init -y
npm install whatsapp-web.js qrcode-terminal @google/generative-ai
```

### Automação Python
```bash
pip install anthropic langchain python-dotenv
```

## Padrões de Código

### Estrutura de um endpoint
```typescript
// ✅ Correto
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const result = await processRequest(body)
    return Response.json({ data: result })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erro interno'
    return Response.json({ error: message }, { status: 500 })
  }
}
```

### Variáveis de ambiente
```typescript
// ✅ Sempre validar no startup
const apiKey = process.env.MY_API_KEY
if (!apiKey) throw new Error('MY_API_KEY não configurada')
```

## Checklist de Entrega
- [ ] Código funciona sem erros?
- [ ] Variáveis de ambiente documentadas?
- [ ] Tratamento de erros implementado?
- [ ] README com instruções de instalação?
- [ ] Dependências todas instaladas?
- [ ] Testado localmente?
