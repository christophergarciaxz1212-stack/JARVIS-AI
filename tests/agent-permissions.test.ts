import { describe, expect, it } from 'vitest'
import {
  classifyTool, decide, describeRequest, isDestructiveCommand, isExternalCommand,
  DEFAULT_PERMISSION_MODE, PERMISSION_MODES,
} from '@/lib/agents/permissions'
import { normalizeArgs } from '@/lib/agents/tools'

describe('classificação de risco das ferramentas', () => {
  it('trata leitura do projeto como leitura', () => {
    expect(classifyTool('read_file', { path: 'src/a.ts' })).toBe('leitura')
    expect(classifyTool('list_dir', {})).toBe('leitura')
    expect(classifyTool('search', { query: 'x' })).toBe('leitura')
    expect(classifyTool('skill_read', { extension: 'x' })).toBe('leitura')
  })

  it('separa coordenação de escrita', () => {
    expect(classifyTool('send_message', { to: 'all' })).toBe('coordenacao')
    expect(classifyTool('finish', { summary: 'ok' })).toBe('coordenacao')
    expect(classifyTool('write_file', { path: 'a.ts' })).toBe('escrita')
    expect(classifyTool('edit_file', { path: 'a.ts' })).toBe('escrita')
  })

  it('classifica run_command pelo comando, não pelo nome da ferramenta', () => {
    expect(classifyTool('run_command', { command: 'npm test' })).toBe('comando')
    expect(classifyTool('run_command', { command: 'npm run build' })).toBe('comando')
    expect(classifyTool('run_command', { command: 'Remove-Item -Recurse src' })).toBe('destrutivo')
    expect(classifyTool('run_command', { command: 'git reset --hard HEAD~3' })).toBe('destrutivo')
    expect(classifyTool('run_command', { command: 'npm install react' })).toBe('externo')
  })

  it('reconhece MCP remoto como ação fora do computador', () => {
    expect(classifyTool('skill_use', { extension: 'x', tool: 'y' })).toBe('comando')
    expect(classifyTool('skill_use', { extension: 'x', tool: 'y', remote: true })).toBe('externo')
    expect(classifyTool('hub_request_action', { type: 'whatsapp-message' })).toBe('externo')
  })

  it('trata ferramenta desconhecida como escrita, para cair na aprovação', () => {
    expect(classifyTool('ferramenta_de_plugin_novo', {})).toBe('escrita')
  })
})

describe('modo restrito', () => {
  it('permite ler e analisar', () => {
        expect(decide('read_file', { path: 'a.ts' }, 'restrito')).toEqual({ allow: true, risk: 'leitura' })
    expect(decide('search', { query: 'x' }, 'restrito').allow).toBe(true)
  })

  it('não escreve nem roda comando, e não oferece aprovação', () => {
    const write = decide('write_file', { path: 'a.ts' }, 'restrito')
    expect(write.allow).toBe(false)
    expect(write.allow === false && write.needsApproval).toBe(false)
    expect(write.allow === false && write.reason).toContain('Restrito')

    const cmd = decide('run_command', { command: 'npm test' }, 'restrito')
    expect(cmd.allow).toBe(false)
    expect(cmd.allow === false && cmd.needsApproval).toBe(false)
  })
})

describe('modo supervisionado', () => {
  it('lê sem perguntar', () => {
    expect(decide('list_dir', {}, 'supervisionado').allow).toBe(true)
  })

  it('pede aprovação para escrever, rodar comando e agir fora do PC', () => {
    for (const [tool, args] of [
      ['write_file', { path: 'a.ts' }],
      ['edit_file', { path: 'a.ts' }],
      ['run_command', { command: 'npm test' }],
      ['run_command', { command: 'Remove-Item a.ts' }],
      ['hub_request_action', { type: 'github-issue' }],
    ] as Array<[string, Record<string, unknown>]>) {
      const d = decide(tool, args, 'supervisionado')
      expect(d.allow, `${tool} deveria pedir aprovação`).toBe(false)
      expect(d.allow === false && d.needsApproval, `${tool} deveria ser aprovável`).toBe(true)
    }
  })
})

describe('modo autônomo', () => {
  it('escreve e roda comandos sem interromper', () => {
    expect(decide('write_file', { path: 'a.ts' }, 'autonomo').allow).toBe(true)
    expect(decide('edit_file', { path: 'a.ts' }, 'autonomo').allow).toBe(true)
    expect(decide('run_command', { command: 'npm run build' }, 'autonomo').allow).toBe(true)
  })

  it('ainda pede aprovação para destrutivo e para o que sai do PC', () => {
    const del = decide('run_command', { command: 'Remove-Item -Recurse src' }, 'autonomo')
    expect(del.allow).toBe(false)
    expect(del.allow === false && del.needsApproval).toBe(true)

    const ext = decide('hub_request_action', { type: 'whatsapp-message' }, 'autonomo')
    expect(ext.allow === false && ext.needsApproval).toBe(true)

    const install = decide('run_command', { command: 'npm install left-pad' }, 'autonomo')
    expect(install.allow === false && install.needsApproval).toBe(true)
  })
})

describe('detecção de comandos', () => {
  it('reconhece exclusões e reescrita de histórico', () => {
    expect(isDestructiveCommand('rm -r build')).toBe(true)
    expect(isDestructiveCommand('git clean -fd')).toBe(true)
    expect(isDestructiveCommand('taskkill /pid 10')).toBe(true)
    expect(isDestructiveCommand('npm test')).toBe(false)
    expect(isDestructiveCommand('node scripts/build.mjs')).toBe(false)
  })

  it('reconhece instalação e download', () => {
    expect(isExternalCommand('pip install requests')).toBe(true)
    expect(isExternalCommand('winget install Git.Git')).toBe(true)
    expect(isExternalCommand('npm run dev')).toBe(false)
  })
})

describe('texto mostrado ao usuário', () => {
  it('descreve o pedido em português, sem jargão', () => {
    expect(describeRequest('run_command', { command: 'npm test' })).toBe('Executar: npm test')
    expect(describeRequest('edit_file', { path: 'src/a.ts' })).toBe('Editar src/a.ts')
    expect(describeRequest('write_file', { path: 'src/b.ts' })).toContain('src/b.ts')
  })
})

describe('configuração padrão', () => {
  it('começa em supervisionado — nem travado, nem solto', () => {
    expect(DEFAULT_PERMISSION_MODE).toBe('supervisionado')
    expect(PERMISSION_MODES).toEqual(['restrito', 'supervisionado', 'autonomo'])
  })
})

describe('aliases de argumento não burlam a classificação', () => {
  it('o alias "cmd" é classificado igual a "command"', () => {
    // Como o orquestrador faz: normaliza ANTES de classificar
    const comAlias = normalizeArgs('run_command', { cmd: 'npm install pacote' })
    expect(decide('run_command', comAlias, 'autonomo').allow).toBe(false)
    expect(classifyTool('run_command', comAlias)).toBe('externo')

    const destrutivo = normalizeArgs('run_command', { comando: 'Remove-Item -Recurse src' })
    expect(classifyTool('run_command', destrutivo)).toBe('destrutivo')

    // E o texto mostrado ao usuário deixa de vir vazio
    expect(describeRequest('run_command', comAlias)).toBe('Executar: npm install pacote')
  })

  it('sem normalizar, o alias escaparia — por isso o orquestrador normaliza', () => {
    // Documenta a armadilha: classificar o argumento cru subestima o risco
    expect(classifyTool('run_command', { cmd: 'npm install pacote' })).toBe('comando')
  })
})
