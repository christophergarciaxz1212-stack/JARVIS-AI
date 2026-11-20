import { FlatCompat } from '@eslint/eslintrc'
import { dirname } from 'path'
import { fileURLToPath } from 'url'

const root = dirname(fileURLToPath(import.meta.url))
const compat = new FlatCompat({ baseDirectory: root })

const config = [
  {
    ignores: [
      'node_modules/**',
      '.next*/**',
      'out/**',
      'data/**',
      'dist/**',
      'electron/**',
      'next-env.d.ts',
      'release/**',
      'release-staging/**',
      '.tmp/**',
    ],
  },
  ...compat.extends('next/core-web-vitals'),
]

export default config
