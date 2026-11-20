export type DeviceType =
  | 'router' | 'switch' | 'l3switch' | 'firewall' | 'server' | 'pc' | 'laptop' | 'cloud' | 'internet'
  | 'ap' | 'loadbalancer' | 'nas' | 'phone' | 'printer' | 'camera' | 'vm'

export type LinkKind = 'ethernet' | 'access' | 'trunk' | 'wan' | 'ha' | 'vpn' | 'wireless' | 'fiber'

export interface Iface {
  name: string
  /** CIDR, e.g. 192.168.10.1/24 */
  ip?: string
  vlan?: number
  /** Allowed VLANs on a trunk */
  vlans?: number[]
  mode?: 'access' | 'trunk' | 'routed'
  description?: string
}

export interface NetNode {
  id: string
  label: string
  type: DeviceType
  vendor?: string
  model?: string
  zone?: string
  mgmt?: string
  ifaces?: Iface[]
  notes?: string
  x?: number
  y?: number
}

export interface NetLink {
  id: string
  a: string
  aPort?: string
  b: string
  bPort?: string
  kind?: LinkKind
  label?: string
  subnet?: string
}

export interface Zone { id: string; label: string; color?: string }

export interface Vlan { id: number; name: string; subnet?: string; gateway?: string }

export interface Topology {
  id: string
  title: string
  description?: string
  zones: Zone[]
  nodes: NetNode[]
  links: NetLink[]
  vlans: Vlan[]
  notes: string[]
  createdAt: number
  updatedAt: number
}

export interface Issue { level: 'error' | 'warn' | 'info'; message: string; node?: string; link?: string }
