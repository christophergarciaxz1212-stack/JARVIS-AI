import { describe, expect, it } from 'vitest'
import { testExtension } from '@/lib/engine/installer'
import type { Extension } from '@/lib/engine/types'
import { tempProject } from './helpers'

const skillPack = (files: Record<string, string>) => {
  const dir = tempProject({ 'tool/SKILL.md': '---\nname: tool\n---\n# Tool', ...files })
  return { id: 'pack-test', kind: 'skill', dir, skills: [{ name: 'tool', path: 'tool/SKILL.md' }], tools: [], permissions: { env: [] } } as unknown as Extension
}

describe('skill pack functional test', () => {
  it('ignores sample outputs and fixtures that are never executed', async () => {
    const ext = skillPack({
      'tool/expected_outputs/scaffold.js': 'return results.filter(Boolean)\n}',
      'tool/fixtures/broken.mjs': 'export default {',
      'tool/assets/templates/fan-out.js': 'const report = []\nreturn report\n',
      'tool/scripts/run.mjs': 'export const ok = 1\n',
    })
    const r = await testExtension(ext)
    expect(r.ok).toBe(true)
    expect(r.output).toMatch(/1 script/)
  })

  it('still fails when a real script has a syntax error', async () => {
    const r = await testExtension(skillPack({ 'tool/scripts/run.mjs': 'export const = 1' }))
    expect(r.ok).toBe(false)
    expect(r.output).toMatch(/Erro de sintaxe em .*run\.mjs/)
  })
})
