import { loadStore, newId, saveStore } from './store'
import type { RiskLevel } from './risk'

export type ApprovalKind = 'ssh-exec' | 'local-exec' | 'install' | 'docker'
export type ApprovalStatus = 'pending' | 'executed' | 'failed' | 'rejected'

export interface InfraApproval {
  id: string
  createdAt: number
  actor: string
  kind: ApprovalKind
  title: string
  command: string
  risk: RiskLevel
  reasons: string[]
  payload: Record<string, unknown>
  status: ApprovalStatus
  decidedAt?: number
  result?: string
}

const FILE = 'approvals.json'
const MAX = 300

export function listApprovals(): InfraApproval[] {
  return loadStore<InfraApproval[]>(FILE, [])
}

export function getApproval(id: string) {
  return listApprovals().find(a => a.id === id)
}

export function requestApproval(input: Omit<InfraApproval, 'id' | 'createdAt' | 'status'>): InfraApproval {
  const all = listApprovals()
  // The same agent asking twice for the same thing reuses the pending request
  const dup = all.find(a => a.status === 'pending' && a.kind === input.kind && a.command === input.command && JSON.stringify(a.payload) === JSON.stringify(input.payload))
  if (dup) return dup
  const item: InfraApproval = { ...input, id: newId('apr'), createdAt: Date.now(), status: 'pending' }
  saveStore(FILE, [...all, item].slice(-MAX))
  return item
}

export function settleApproval(id: string, status: Exclude<ApprovalStatus, 'pending'>, result?: string) {
  const all = listApprovals()
  const item = all.find(a => a.id === id)
  if (!item) throw new Error('Aprovação não encontrada')
  if (item.status !== 'pending') throw new Error(`Esta solicitação já foi ${item.status === 'rejected' ? 'recusada' : 'processada'}`)
  item.status = status
  item.decidedAt = Date.now()
  item.result = result?.slice(0, 8000)
  saveStore(FILE, all)
  return item
}

export const pendingApprovals = () => listApprovals().filter(a => a.status === 'pending')
