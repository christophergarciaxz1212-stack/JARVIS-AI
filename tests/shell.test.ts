import { describe, it, expect } from 'vitest'
import { isSafeAgentCommand, preferredShell, runWithShell } from '@/lib/shell'

describe('preferredShell', () => {
  it('detects PowerShell-specific syntax', () => {
    expect(preferredShell('npm test')).toBe('cmd')
    expect(preferredShell('git status')).toBe('cmd')
    expect(preferredShell('dir')).toBe('cmd')
    expect(preferredShell('Get-ChildItem -Path .')).toBe('powershell')
    expect(preferredShell('$env:PATH')).toBe('powershell')
    expect(preferredShell('echo $PSHOME')).toBe('powershell')
    expect(preferredShell('ConvertTo-Json -InputObject $o')).toBe('powershell')
    expect(preferredShell('.\\script.ps1')).toBe('powershell')
    expect(preferredShell('Get-Content package.json | Select-Object -First 10')).toBe('powershell')
  })

  it('keeps PowerShell aliases and syntax in PowerShell', () => {
    for (const c of ['ls', 'ls src', 'cat package.json', 'pwd', 'rm out.txt', 'cp a.txt b.txt', 'mkdir src\\x']) {
      expect(preferredShell(c)).toBe('powershell')
    }
    expect(preferredShell('npm install; npm test')).toBe('powershell')
    expect(preferredShell("git commit -m 'fix bug'")).toBe('powershell')
    expect(preferredShell('echo "texto"')).toBe('powershell')
    expect(preferredShell('& "C:\\Program Files\\nodejs\\node.exe" -v')).toBe('powershell')
  })

  it('uses cmd.exe for plain program chains', () => {
    expect(preferredShell('npm install && npm test')).toBe('cmd')
    expect(preferredShell('cd src && npm test')).toBe('cmd')
    expect(preferredShell('where node')).toBe('cmd')
    expect(preferredShell('git commit -m "fix: it\'s done (finally)"')).toBe('cmd')
    expect(preferredShell('npm run build 2>&1')).toBe('cmd')
    expect(preferredShell('git log --oneline | findstr fix')).toBe('cmd')
  })
})

describe('runWithShell execution', () => {
  it('runs a trivial command via cmd.exe fast path', async () => {
    const r = await runWithShell('echo jarvis_fast_ok_123', process.cwd(), { timeoutMs: 10_000 })
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('jarvis_fast_ok_123')
  })

  it('routes PowerShell syntax to PowerShell', async () => {
    const r = await runWithShell('Write-Output (1 + 1)', process.cwd(), { timeoutMs: 30_000 })
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('2')
  }, 35_000)

  it('runs npm-compatible commands through the fast path', async () => {
    const r = await runWithShell('echo fast_path_ok', process.cwd(), { timeoutMs: 10_000 })
    expect(r.exitCode).toBe(0)
    expect(r.stdout).toMatch(/fast_path_ok/)
  })

  it('passes double-quoted arguments intact through cmd.exe', async () => {
    const r = await runWithShell('node -e "console.log(process.argv.slice(1).join(\'|\'))" "a b" c', process.cwd(), { timeoutMs: 20_000 })
    expect(r.exitCode).toBe(0)
    expect(r.stdout.trim()).toBe('a b|c')
  }, 25_000)

  it('keeps accents in PowerShell output', async () => {
    const r = await runWithShell('Write-Output "ação"', process.cwd(), { timeoutMs: 30_000 })
    expect(r.stdout.trim()).toBe('ação')
  }, 35_000)

  it('honors an explicit shell choice', async () => {
    const cmd = await runWithShell('echo %OS%', process.cwd(), { timeoutMs: 10_000, shell: 'cmd' })
    expect(cmd.stdout.trim()).toBe('Windows_NT')
    const ps = await runWithShell('ls package.json', process.cwd(), { timeoutMs: 30_000, shell: 'powershell' })
    expect(ps.exitCode).toBe(0)
    expect(ps.stdout).toMatch(/package\.json/)
  }, 45_000)

  it('agent safety gate blocks destructive and git-destructive commands', () => {
    expect(isSafeAgentCommand('git push')).not.toBeNull()
    expect(isSafeAgentCommand('Remove-Item -Recurse -Force .')).not.toBeNull()
    expect(isSafeAgentCommand('dir')).toBeNull()
    expect(isSafeAgentCommand('npx tsc --noEmit')).toBeNull()
  })
})
