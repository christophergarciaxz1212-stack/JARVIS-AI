import { describe, it, expect } from 'vitest'
import { createElement } from 'react'
import { textOf } from '@/components/chat/textOf'

describe('textOf', () => {
  it('flattens highlighted code (nested spans) into the plain source', () => {
    const highlighted = createElement('code', { className: 'hljs language-ts' },
      createElement('span', { className: 'hljs-keyword' }, 'const'),
      ' x = ',
      createElement('span', { className: 'hljs-number' }, 1),
      createElement('span', null, createElement('span', null, ' // nested')),
      '\n',
    )
    expect(textOf(highlighted)).toBe('const x = 1 // nested\n')
  })

  it('ignores empty and boolean children', () => {
    expect(textOf([null, false, 'a', undefined, true, ['b', ['c']]])).toBe('abc')
  })
})
