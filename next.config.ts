import type { NextConfig } from 'next'

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['baileys'],
  devIndicators: false,
  // Dev server and production build get separate folders so `next dev` can't clobber the fast build the app runs on
  // JARVIS_DIST_DIR builds/serves a separate copy for validation without touching the running app
  distDir: process.env.JARVIS_DIST_DIR || (process.env.NODE_ENV === 'development' ? '.next-dev' : '.next'),
  poweredByHeader: false,
  // Menos resolução de módulos no build e bundle final menor.
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  // Baileys importa jimp/sharp opcionalmente (processamento de imagem para ENVIO).
  // jimp e sharp estão instalados como dependências, então a resolução ocorre normalmente;
  // o JARVIS apenas lê mensagens e nunca envia imagens pessoais.
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}

export default nextConfig
