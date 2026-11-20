// JARVIS — configuração do Next para o pacote distribuído (sem TypeScript: `next start` carrega sem instalar nada).
// Fica fora da raiz de propósito: o Next carrega next.config.js ANTES de next.config.ts, então um .js na raiz
// fazia o projeto inteiro ignorar o next.config.ts. O scripts/prepare-dist.mjs copia este arquivo para o pacote.
// Mantenha os campos iguais aos do next.config.ts.
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
]

module.exports = {
  serverExternalPackages: ['baileys'],
  devIndicators: false,
  // JARVIS_DIST_DIR permite builds/validação isolados (ex.: .next-dist) sem tocar no .next do app em execução
  distDir: process.env.JARVIS_DIST_DIR || '.next',
  poweredByHeader: false,
  experimental: {
    optimizePackageImports: ['lucide-react', 'framer-motion'],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }]
  },
}
