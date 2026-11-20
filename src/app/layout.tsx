import type { Metadata } from 'next'
import './globals.css'
import './operations.css'
import './motion.css'
import { Toaster } from 'sonner'
import MotionLayer from '@/components/MotionLayer'

export const metadata: Metadata = {
  title: 'JARVIS AI — Agente Pessoal',
  description: 'Agente de inteligência artificial pessoal avançado',
  icons: { icon: '/favicon.ico' },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        {/* Applies the saved theme/accent before the first paint (no flash of the default look) */}
        <script dangerouslySetInnerHTML={{ __html: `try{var l=JSON.parse(localStorage.getItem('jarvis.look')||'{}');for(var k in l)document.documentElement.dataset[k]=l[k]}catch(e){}` }} />
      </head>
      <body className="bg-black text-white overflow-hidden h-screen">
        {children}
        <MotionLayer />
        <Toaster
          theme="dark"
          position="bottom-right"
          toastOptions={{
            style: {
              background: '#0a0a0a',
              border: '1px solid rgba(255,255,255,0.1)',
              color: '#f0f0f0',
            },
          }}
        />
      </body>
    </html>
  )
}
