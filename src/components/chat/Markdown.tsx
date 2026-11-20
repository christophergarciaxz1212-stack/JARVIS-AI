'use client'

import { isValidElement } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeHighlight from 'rehype-highlight'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { textOf } from './textOf'

function copy(text: string) {
  navigator.clipboard.writeText(text).then(() => toast.success('Código copiado')).catch(() => toast.error('Não foi possível copiar'))
}

const components: Components = {
  pre({ children }) {
    const code = isValidElement<{ className?: string }>(children) ? children : null
    const lang = code?.props.className?.match(/language-([\w+#.-]+)/)?.[1]
    const text = textOf(children).replace(/\n$/, '')
    return (
      <div className="md-code">
        <div className="md-code-bar">
          <span>{lang || 'código'}</span>
          <button type="button" onClick={() => copy(text)} title="Copiar código">
            <Copy size={11} /> Copiar
          </button>
        </div>
        <pre>{children}</pre>
      </div>
    )
  },
  code({ className, children }) {
    // Fenced blocks keep their trailing newline; inline code never has one
    const block = /language-/.test(className || '') || textOf(children).includes('\n')
    return <code className={block ? className : 'md-inline-code'}>{children}</code>
  },
  a({ href, title, children }) {
    // In the desktop app an external link must open in the browser, never replace the app window
    const external = /^https?:\/\//i.test(href || '')
    return external
      ? <a href={href} title={title} target="_blank" rel="noopener noreferrer">{children}</a>
      : <a href={href} title={title}>{children}</a>
  },
  table({ children }) {
    return <div className="md-table"><table>{children}</table></div>
  },
}

/** Markdown with the app's typography: headings, lists, tables, quotes and highlighted code with a copy bar. */
export default function Markdown({ children, className = '' }: { children: string; className?: string }) {
  return (
    <div className={`prose ${className}`}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
}
