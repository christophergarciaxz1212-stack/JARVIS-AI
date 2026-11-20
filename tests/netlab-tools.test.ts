import { describe, expect, it } from 'vitest'
import { ipToInt } from '@/lib/netlab/ip'
import { maskToPrefix, parseNetInput, prefixForHosts, splitEqual, subnetInfo, summarize, vlsm } from '@/lib/netlab/subnet'
import { diagRunner, findTarget, netToolRunner, parseHostRequests, subnetRunner } from '@/lib/netlab/tools'
import { normalizeTopology, validateTopology } from '@/lib/netlab/model'
import { shouldRunAgent } from '@/lib/agents/shouldRunAgent'

const net = (s: string) => { const p = parseNetInput(s)!; return { network: p.ip, prefix: p.prefix } }

describe('calculadora IPv4', () => {
  it('sub-rede completa de um host', () => {
    const i = subnetInfo(ipToInt('192.168.10.77')!, 26)
    expect(i).toMatchObject({ network: '192.168.10.64', broadcast: '192.168.10.127', mask: '255.255.255.192', wildcard: '0.0.0.63', firstHost: '192.168.10.65', lastHost: '192.168.10.126', usable: 62, total: 64, klass: 'C' })
    expect(i.kind).toMatch(/privado/)
    expect(subnetInfo(ipToInt('10.0.0.0')!, 31).usable).toBe(2)
    expect(subnetInfo(ipToInt('8.8.8.8')!, 32).usable).toBe(1)
    expect(subnetInfo(ipToInt('100.70.1.1')!, 10).kind).toMatch(/CGNAT/)
    expect(subnetInfo(ipToInt('169.254.3.3')!, 16).kind).toMatch(/APIPA/)
  })
  it('lê máscara em CIDR, decimal e classe padrão; recusa máscara não contígua', () => {
    expect(parseNetInput('172.16.5.4 255.255.240.0')).toMatchObject({ prefix: 20 })
    expect(parseNetInput('10.1.2.3 máscara 255.0.0.0')).toMatchObject({ prefix: 8 })
    expect(parseNetInput('calcule 192.168.1.10 / 27')).toMatchObject({ prefix: 27 })
    expect(parseNetInput('130.10.0.1')).toMatchObject({ prefix: 16 })
    expect(maskToPrefix('255.0.255.0')).toBeNull()
    expect(maskToPrefix('0.0.0.0')).toBe(0)
    expect(parseNetInput('192.168.1.1/40')).toBeNull()
  })
  it('prefixo por quantidade de hosts', () => {
    expect(prefixForHosts(2)).toBe(30)
    expect(prefixForHosts(62)).toBe(26)
    expect(prefixForHosts(63)).toBe(25)
    expect(prefixForHosts(500)).toBe(23)
  })
  it('divide em partes iguais (e avisa quando não é potência de 2)', () => {
    const r = splitEqual(net('192.168.0.0/24'), { parts: 4 })
    expect(r.blocks.map(b => `${b.network}/${b.prefix}`)).toEqual(['192.168.0.0/26', '192.168.0.64/26', '192.168.0.128/26', '192.168.0.192/26'])
    const r3 = splitEqual(net('10.0.0.0/24'), { parts: 3 })
    expect(r3.blocks).toHaveLength(4)
    expect(r3.note).toMatch(/potência de 2/)
    expect(splitEqual(net('10.0.0.0/24'), { newPrefix: 27 }).blocks).toHaveLength(8)
    expect(() => splitEqual(net('10.0.0.0/24'), { newPrefix: 20 })).toThrow()
  })
  it('VLSM aloca do maior para o menor, alinhado, e mostra o que sobra', () => {
    const r = vlsm(net('192.168.10.0/24'), [{ name: 'TI', hosts: 12 }, { name: 'Vendas', hosts: 60 }, { name: 'WAN', hosts: 2 }, { name: 'RH', hosts: 25 }])
    expect(r.blocks.map(b => `${b.name} ${b.network}/${b.prefix}`)).toEqual([
      'Vendas 192.168.10.0/26', 'RH 192.168.10.64/27', 'TI 192.168.10.96/28', 'WAN 192.168.10.112/30',
    ])
    expect(r.free[0]).toMatchObject({ network: '192.168.10.116', prefix: 30 })
    expect(r.free.reduce((s, b) => s + 2 ** (32 - b.prefix), 0)).toBe(256 - 64 - 32 - 16 - 4)
    expect(() => vlsm(net('192.168.10.0/26'), [{ hosts: 100 }])).toThrow(/maior que a rede|Não cabe/)
    expect(() => vlsm(net('192.168.10.0/25'), [{ hosts: 60 }, { hosts: 60 }, { hosts: 10 }])).toThrow(/Não cabe/)
  })
  it('sumariza rotas e avisa quando a rota resumida cobre mais do que devia', () => {
    const exact = summarize(['192.168.0.0/24', '192.168.1.0/24', '192.168.2.0/24', '192.168.3.0/24'].map(net))
    expect(exact).toMatchObject({ network: '192.168.0.0', prefix: 22, exact: true })
    const loose = summarize(['10.0.0.0/24', '10.0.2.0/24'].map(net))
    expect(loose).toMatchObject({ network: '10.0.0.0', prefix: 22, exact: false, extra: 512 })
  })
})

describe('ferramentas de rede no chat', () => {
  it('detecta pedidos de cálculo e responde com a tabela exata', async () => {
    const r = await subnetRunner('calcule a sub-rede 192.168.10.77/26')!()
    expect(r).toContain('192.168.10.64/26')
    expect(r).toContain('255.255.255.192')
    expect(r).toContain('**62**')
    expect(await subnetRunner('quantos hosts tem um /27')!()).toMatch(/30\*\* hosts/)
    expect(await subnetRunner('qual mascara para 120 hosts?')!()).toMatch(/\/25/)
  })
  it('VLSM e divisão pelo chat', async () => {
    const v = await subnetRunner('faça o vlsm de 10.10.0.0/24 para vendas 50 hosts, rh 20 hosts e ti 10 hosts')!()
    expect(v).toContain('vendas')
    expect(v).toContain('10.10.0.0/26')
    expect(v).toContain('10.10.0.64/27')
    const s = await subnetRunner('divida 172.16.0.0/16 em 4 sub-redes')!()
    expect(s).toContain('172.16.192.0/18')
    expect(await subnetRunner('sumarize 10.1.0.0/24 e 10.1.1.0/24')!()).toContain('10.1.0.0/23')
  })
  it('lê a lista de hosts do VLSM com nomes', () => {
    expect(parseHostRequests('10.0.0.0/24 para vendas 50 hosts, rh 20 e financeiro (12)')).toEqual([{ name: 'vendas', hosts: 50 }, { name: 'rh', hosts: 20 }, { name: 'financeiro', hosts: 12 }])
    expect(parseHostRequests('vlsm 10.0.0.0/24 para 100, 50, 20 e 2 hosts').map(r => r.hosts)).toEqual([100, 50, 20, 2])
  })
  it('não rouba pedidos de projeto de rede nem conversa comum', () => {
    expect(subnetRunner('crie uma topologia com a sub-rede 10.0.0.0/24 para vendas')).toBeNull()
    expect(subnetRunner('o que é uma sub-rede?')).toBeNull()
    expect(diagRunner('crie um laboratorio com servidor dns 8.8.8.8')).toBeNull()
    expect(diagRunner('o que é ping?')).toBeNull()
    expect(diagRunner('me manda o relatorio.pdf por email')).toBeNull()
  })
  it('acha o alvo: URL, IP:porta, domínio — e ignora nomes de arquivo', () => {
    expect(findTarget('o site https://meusite.com.br/login caiu?')).toBe('https://meusite.com.br/login')
    expect(findTarget('teste 10.0.0.5:5432')).toBe('10.0.0.5:5432')
    expect(findTarget('pinga google.com por favor')).toBe('google.com')
    expect(findTarget('abra o arquivo relatorio.pdf')).toBeNull()
  })
  it('reconhece cada diagnóstico (sem executar nada)', () => {
    for (const q of ['pinga 8.8.8.8', 'faça um ping em google.com', 'traceroute até 1.1.1.1', 'qual o ip de github.com', 'resolva o dns de google.com', 'teste a porta 443 de google.com', 'o 192.168.0.10:22 está aberto?', 'diagnostique https://site.com', 'o site exemplo.com.br caiu?', 'quais portas estão abertas neste pc']) {
      expect(netToolRunner(q), q).not.toBeNull()
    }
  })
  it('sem servidor, o diagnóstico avisa em vez de fingir', async () => {
    await expect(diagRunner('pinga 8.8.8.8')!()).rejects.toThrow(/só roda no servidor/)
  })
  it('o roteador do modo agente manda essas perguntas para o chat', () => {
    expect(shouldRunAgent('calcule a sub-rede 10.0.0.0/22')).toBe(false)
    expect(shouldRunAgent('pinga 8.8.8.8')).toBe(false)
    expect(shouldRunAgent('teste a porta 443 de google.com')).toBe(false)
  })
})

describe('validação de projeto mais profunda', () => {
  const topo = (raw: Record<string, unknown>) => normalizeTopology(raw)
  it('IP fora da sub-rede da VLAN e gateway inválido/ausente', () => {
    const t = topo({
      vlans: [{ id: 10, name: 'Vendas', subnet: '10.0.10.0/24', gateway: '10.0.10.1' }, { id: 20, name: 'RH', subnet: '10.0.20.0/24', gateway: '10.0.30.1' }],
      nodes: [
        { id: 'rt', type: 'router', ifaces: [{ name: 'g0', ip: '10.0.10.2/24', vlan: 10 }] },
        { id: 'pc', type: 'pc', ifaces: [{ name: 'eth0', ip: '10.0.11.5/24', vlan: 10 }] },
      ],
      links: [{ a: 'rt', b: 'pc' }],
    })
    const msgs = validateTopology(t).map(i => i.message).join('\n')
    expect(msgs).toMatch(/fora da sub-rede da VLAN 10/)
    expect(msgs).toMatch(/VLAN 20: gateway 10.0.30.1 fora da sub-rede/)
    expect(msgs).toMatch(/VLAN 10: o gateway 10.0.10.1 não está configurado/)
    // Com switch L3 ou firewall, as configurações geradas criam a SVI/subinterface do gateway: sem aviso
    const withL3 = normalizeTopology({ vlans: [{ id: 10, name: 'V', subnet: '10.0.10.0/24', gateway: '10.0.10.1' }], nodes: [{ id: 'core', type: 'l3switch', ifaces: [{ name: 'g1', ip: '10.0.99.1/30' }] }], links: [] })
    expect(validateTopology(withL3).map(i => i.message).join('\n')).not.toMatch(/não está configurado/)
  })
  it('sobreposição entre redes de interfaces e estação sem gateway', () => {
    const t = topo({
      nodes: [
        { id: 'r1', type: 'router', ifaces: [{ name: 'g0', ip: '10.0.0.1/24' }, { name: 'g1', ip: '10.0.0.129/25' }] },
        { id: 'pc', type: 'pc', ifaces: [{ name: 'e0', ip: '192.168.50.10/24' }] },
      ],
      links: [{ a: 'r1', b: 'pc', aPort: 'g0', bPort: 'e0' }],
    })
    const msgs = validateTopology(t).map(i => i.message).join('\n')
    expect(msgs).toMatch(/Sub-redes sobrepostas: .*10\.0\.0\.0\/24.*10\.0\.0\.128\/25/)
    expect(msgs).toMatch(/pc \(192\.168\.50\.0\/24\) não tem gateway/)
  })
  it('laço de camada 2 sem STP é aviso; com STP citado vira só informação', () => {
    const base = {
      nodes: [{ id: 's1', type: 'switch' }, { id: 's2', type: 'switch' }, { id: 's3', type: 'switch' }],
      links: [{ a: 's1', b: 's2' }, { a: 's2', b: 's3' }, { a: 's3', b: 's1' }],
    }
    const loop = validateTopology(topo(base)).find(i => /camada 2/.test(i.message))!
    expect(loop.level).toBe('warn')
    const withStp = validateTopology(topo({ ...base, notes: ['RSTP ativo em todos os switches'] })).find(i => /camada 2/.test(i.message))!
    expect(withStp.level).toBe('info')
  })
  it('borda sem firewall e ponto único de falha', () => {
    const t = topo({
      nodes: [
        { id: 'inet', type: 'internet' }, { id: 'srv', type: 'server' }, { id: 'r1', type: 'router' },
        { id: 'sw', type: 'switch' }, { id: 'pc1', type: 'pc' }, { id: 'pc2', type: 'pc' },
      ],
      links: [{ a: 'inet', b: 'srv' }, { a: 'inet', b: 'r1' }, { a: 'r1', b: 'sw' }, { a: 'sw', b: 'pc1' }, { a: 'sw', b: 'pc2' }],
    })
    const issues = validateTopology(t)
    expect(issues.some(i => i.level === 'warn' && /srv está ligado direto à internet/.test(i.message))).toBe(true)
    expect(issues.some(i => i.level === 'info' && /sem nenhum firewall/.test(i.message))).toBe(true)
    expect(issues.some(i => i.level === 'info' && /Ponto\(s\) único\(s\) de falha: .*(r1|sw)/.test(i.message))).toBe(true)
  })
  it('trunk com VLANs diferentes nas pontas', () => {
    const t = topo({
      nodes: [
        { id: 'a', type: 'switch', ifaces: [{ name: 'g1', mode: 'trunk', vlans: [10, 20, 30] }] },
        { id: 'b', type: 'switch', ifaces: [{ name: 'g1', mode: 'trunk', vlans: [10, 20] }] },
      ],
      links: [{ a: 'a', b: 'b', aPort: 'g1', bPort: 'g1' }],
    })
    expect(validateTopology(t).map(i => i.message).join('\n')).toMatch(/só em a: 30/)
  })
})
