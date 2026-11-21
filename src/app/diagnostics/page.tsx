import DiagnosticsPanel from '@/components/DiagnosticsPanel'

/** Tela dedicada de diagnóstico interno — mesma fonte de dados do painel do shell. */
export default function DiagnosticsPage() {
  return (
    <main className="h-screen w-screen bg-black text-white" aria-label="Diagnóstico interno do JARVIS">
      <DiagnosticsPanel />
    </main>
  )
}
