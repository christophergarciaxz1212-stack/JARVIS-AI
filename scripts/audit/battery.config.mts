import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig } from 'vitest/config'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')

// Audit battery: real tasks against a running JARVIS server (not part of `npm test`)
export default defineConfig({
  resolve: { alias: { '@': path.resolve(root, 'src') } },
  test: {
    root,
    environment: 'node',
    include: ['scripts/audit/*.battery.ts'],
    testTimeout: 3_600_000,
    pool: 'forks',
  },
})
