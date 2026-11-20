// Runs once when the JARVIS server boots: starts the Infrastructure Core (watchdog,
// scheduled backups, process error logging) so monitoring doesn't depend on the UI being open.
// The Node-only code lives in its own module so the Edge bundle never sees fs/child_process.
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./instrumentation-node')
  }
}
