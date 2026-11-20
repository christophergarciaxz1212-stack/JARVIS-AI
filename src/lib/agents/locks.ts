import path from 'path'

interface Holder {
  owner: string
  label: string
  waiters: Array<() => void>
}

/**
 * Exclusive per-file write locks shared by every run in the process, so two agents
 * (even from different runs on the same project) can never write the same file at once.
 * A lock is held until the owner releases it (normally when its task ends), which also
 * stops another agent from interleaving edits into a half-finished change.
 */
export class FileLockManager {
  private locks = new Map<string, Holder>()

  private key(file: string) {
    return path.resolve(file).toLowerCase()
  }

  holder(file: string): { owner: string; label: string } | undefined {
    const h = this.locks.get(this.key(file))
    return h && { owner: h.owner, label: h.label }
  }

  /** Resolves once `owner` holds the lock; rejects on timeout or abort. Re-entrant for the same owner. */
  async acquire(file: string, owner: string, label: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}) {
    const key = this.key(file)
    const deadline = Date.now() + (opts.timeoutMs ?? 60_000)
    for (;;) {
      const h = this.locks.get(key)
      if (!h) { this.locks.set(key, { owner, label, waiters: [] }); return }
      if (h.owner === owner) return
      if (opts.signal?.aborted) throw new Error('Cancelado')
      const remaining = deadline - Date.now()
      if (remaining <= 0) throw new Error(`Arquivo em uso por ${h.label}. Combine com esse agente por mensagem ou tente mais tarde.`)
      await new Promise<void>(resolve => {
        const timer = setTimeout(done, remaining)
        const onAbort = () => done()
        let doneCalled = false
        // Removable waiter: a woken/timed-out waiter must not linger in the holder's list
        const waiter = () => { done() }
        const holder = h!
        function done() {
          if (doneCalled) return
          doneCalled = true
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          const i = holder.waiters.indexOf(waiter)
          if (i >= 0) holder.waiters.splice(i, 1)
          resolve()
        }
        h.waiters.push(waiter)
        opts.signal?.addEventListener('abort', onAbort, { once: true })
      })
    }
  }

  release(file: string, owner: string) {
    const key = this.key(file)
    const h = this.locks.get(key)
    if (!h || h.owner !== owner) return
    this.locks.delete(key)
    for (const w of h.waiters) w()
  }

  releaseAll(owner: string) {
    for (const [key, h] of [...this.locks]) {
      if (h.owner !== owner) continue
      this.locks.delete(key)
      for (const w of h.waiters) w()
    }
  }

  /** Releases every lock whose owner id starts with the prefix (all agents of a run). */
  releasePrefix(prefix: string) {
    for (const [key, h] of [...this.locks]) {
      if (!h.owner.startsWith(prefix)) continue
      this.locks.delete(key)
      for (const w of h.waiters) w()
    }
  }

  held(): Array<{ file: string; owner: string; label: string }> {
    return [...this.locks].map(([file, h]) => ({ file, owner: h.owner, label: h.label }))
  }
}
