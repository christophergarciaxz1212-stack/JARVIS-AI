/**
 * First Run Setup - Sistema de configuração automática na primeira execução.
 * Detecta o ambiente, verifica dependências e configura o JARVIS.
 */
import { dataDir, readJson, writeJsonAtomic } from './agents/fsutil'
import path from 'path'
import os from 'os'

export interface SystemInfo {
  platform: 'win32' | 'linux' | 'darwin'
  osVersion: string
  arch: 'x64' | 'arm64'
  cpuModel: string
  cpuCores: number
  ramTotal: number
  gpu: 'nvidia' | 'amd' | 'intel' | 'none'
  gpuMemory: number
  diskFree: number
  diskTotal: number
  hasAdmin: boolean
  internet: boolean
}

export interface DependencyStatus {
  node: boolean
  npm: boolean
  ffmpeg: boolean
  ollama: boolean
  chrome: boolean
  git: boolean
}

export interface SetupProgress {
  stage: number
  total: number
  status: 'pending' | 'in-progress' | 'completed' | 'error'
  message: string
  percent: number
}

export class FirstRunSetup {
  private readonly appDataDir: string
  private config: any

  constructor() {
    this.appDataDir = dataDir()
    this.config = this.loadConfig()
    this.ensureDirectories()
  }

  private loadConfig(): any {
    const configPath = path.join(this.appDataDir, 'setup-config.json')
    try {
      const data = readJson<any>(configPath, null)
      if (data && data.lastRun && Date.now() - data.lastRun < 30 * 24 * 60 * 60 * 1000) {
        return data
      }
    } catch {}
    return { firstRun: true, runCount: 0 }
  }

  private saveConfig(config: any): void {
    config.lastRun = Date.now()
    config.runCount = (this.config?.runCount || 0) + 1
    const configPath = path.join(this.appDataDir, 'setup-config.json')
    writeJsonAtomic(configPath, config)
  }

  private ensureDirectories(): void {
    const dirs = [
      this.appDataDir,
      path.join(this.appDataDir, 'cache'),
      path.join(this.appDataDir, 'temp'),
      path.join(this.appDataDir, 'logs'),
      path.join(this.appDataDir, 'projects'),
    ]
    for (const dir of dirs) {
      try { require('fs').mkdirSync(dir, { recursive: true }) } catch {}
    }
  }

  isFirstRun(): boolean {
    return this.config?.firstRun === true
  }

  async detectSystem(): Promise<SystemInfo> {
    const os = await import('os')
    const fs = await import('fs')
    const { execSync } = await import('child_process')

    const platform = process.platform as 'win32' | 'linux' | 'darwin'
    const osVersion = os.release()
    const arch = process.arch as 'x64' | 'arm64'
    const cpuModel = os.cpus()[0]?.model || 'Unknown'
    const cpuCores = os.cpus().length
    const ramTotal = Math.round(os.totalmem() / (1024 ** 3))

    let gpu: 'nvidia' | 'amd' | 'intel' | 'none' = 'none'
    let gpuMemory = 0
    try {
      if (process.platform === 'win32') {
        const output = execSync('wmic path win32_VideoController get name,AdapterRAM /format:csv', { encoding: 'utf-8', timeout: 10000 })
        if (output.toLowerCase().includes('nvidia')) gpu = 'nvidia'
        else if (output.toLowerCase().includes('amd')) gpu = 'amd'
        else if (output.toLowerCase().includes('intel')) gpu = 'intel'
      }
    } catch {}

    let diskFree = 0
    let diskTotal = 0
    try {
      const stat = fs.statfsSync(process.cwd())
      diskFree = Math.round((stat.bfree * stat.bsize) / (1024 ** 3))
      diskTotal = Math.round((stat.blocks * stat.bsize) / (1024 ** 3))
    } catch {}

    let hasAdmin = false
    try {
      if (process.platform === 'win32') {
        const { execSync } = await import('child_process')
        hasAdmin = execSync('net session', { encoding: 'utf-8', timeout: 3000, stdio: 'pipe' }).includes('')
      } else {
        hasAdmin = (os as any).getuid?.() === 0
      }
    } catch {}

    let internet = false
    try {
      const res = await fetch('https://www.google.com', { signal: AbortSignal.timeout(5000) })
      internet = res.ok
    } catch {}

    return { platform, osVersion, arch, cpuModel, cpuCores, ramTotal, gpu, gpuMemory, diskFree, diskTotal, hasAdmin, internet }
  }

  async checkDependencies(): Promise<DependencyStatus> {
    const { execSync } = await import('child_process')
    const check = (cmd: string): boolean => {
      try { execSync(cmd, { encoding: 'utf-8', timeout: 5000, stdio: 'pipe' }); return true } catch { return false }
    }
    return {
      node: check('node --version'),
      npm: check('npm --version'),
      ffmpeg: check('ffmpeg -version'),
      ollama: check('ollama --version'),
      chrome: check('where chrome') || check('where chromium'),
      git: check('git --version'),
    }
  }

  async startSetup(onProgress: (progress: SetupProgress) => void): Promise<{ success: boolean; completed: boolean; error?: string }> {
    onProgress({ stage: 1, total: 8, status: 'in-progress', message: 'Iniciando configuração...', percent: 12 })
    const system = await this.detectSystem()
    ;(this.config as any).system = system
    onProgress({ stage: 2, total: 8, status: 'in-progress', message: 'Detectando sistema operacional e hardware...', percent: 25 })
    const deps = await this.checkDependencies()
    ;(this.config as any).deps = deps
    onProgress({ stage: 3, total: 8, status: 'in-progress', message: 'Verificando dependências...', percent: 37 })

    const errors: string[] = []
    if (system.ramTotal < 4) errors.push(`RAM insuficiente: ${system.ramTotal}GB. Recomendado: 8GB+`)
    if (system.diskFree < 2) errors.push(`Espaço em disco insuficiente: ${system.diskFree}GB. Recomendado: 5GB+`)
    if (!deps.node) errors.push('Node.js não encontrado. Por favor, instale o Node.js 18+')

    this.saveConfig({ ...this.config, firstRun: false, lastRun: Date.now() })

    if (errors.length) {
      return { success: false, completed: false, error: errors.join('; ') }
    }
    return { success: true, completed: true }
  }
}