import fs from 'fs'
import net from 'net'
import path from 'path'
import { spawn, type ChildProcess } from 'child_process'

type HostStatus = 'idle' | 'starting' | 'running'

type HostState = {
  status: HostStatus
  child?: ChildProcess
  startPromise?: Promise<void>
  cleanupRegistered?: boolean
}

export type EnsureHostOptions = {
  host?: string
  port?: number
  appPath?: string
  cliPackage?: string
  runtime?: string
  timeoutMs?: number
  debug?: boolean
}

const HOST_KEY = '__agentconnectHostState__'

function getState(): HostState {
  const globalAny = globalThis as typeof globalThis & Record<string, HostState | undefined>
  if (!globalAny[HOST_KEY]) {
    globalAny[HOST_KEY] = { status: 'idle' }
  }
  return globalAny[HOST_KEY]!
}

function findExecutable(name: string): string | null {
  const envPath = process.env.PATH || ''
  const extensions = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : ['']
  for (const entry of envPath.split(path.delimiter)) {
    if (!entry) continue
    for (const ext of extensions) {
      const candidate = path.join(entry, `${name}${ext}`)
      try {
        fs.accessSync(candidate, fs.constants.X_OK)
        return candidate
      } catch {
        continue
      }
    }
  }
  return null
}

function findPackageRoot(startDir: string, pkgName: string): string | null {
  let current = startDir
  while (true) {
    const candidate = path.join(current, 'node_modules', pkgName, 'package.json')
    if (fs.existsSync(candidate)) return path.dirname(candidate)
    const parent = path.dirname(current)
    if (parent === current) break
    current = parent
  }
  return null
}

function resolveCliEntry(appPath: string, cliPackage: string): string {
  const pkgRoot = findPackageRoot(appPath, cliPackage)
  if (!pkgRoot) {
    throw new Error(`AgentConnect CLI not found. Install ${cliPackage} and retry.`)
  }
  const pkgJsonPath = path.join(pkgRoot, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8')) as {
    bin?: string | Record<string, string>
    main?: string
  }
  let entry = pkg.main || 'dist/index.js'
  if (typeof pkg.bin === 'string') {
    entry = pkg.bin
  } else if (pkg.bin && typeof pkg.bin === 'object') {
    entry = pkg.bin.agentconnect || entry
  }
  const resolved = path.join(pkgRoot, entry)
  if (!fs.existsSync(resolved)) {
    throw new Error(`AgentConnect CLI entry not found at ${resolved}`)
  }
  return resolved
}

function resolveRuntime(runtime?: string): string {
  if (runtime) return runtime
  const override = process.env.AGENTCONNECT_NODE
  if (override) return override
  if (!process.execPath.toLowerCase().includes('bun')) return process.execPath
  return findExecutable('node') || 'node'
}

function isPortOpen(host: string, port: number, timeoutMs = 300): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    const finalize = (result: boolean) => {
      socket.destroy()
      resolve(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('error', () => finalize(false))
    socket.once('timeout', () => finalize(false))
    socket.connect(port, host, () => finalize(true))
  })
}

async function waitForPort(
  host: string,
  port: number,
  child: ChildProcess | undefined,
  timeoutMs: number
): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (await isPortOpen(host, port)) return true
    if (child?.exitCode !== null) return false
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return isPortOpen(host, port)
}

function registerCleanup(state: HostState): void {
  if (state.cleanupRegistered) return
  state.cleanupRegistered = true
  process.on('exit', () => {
    state.child?.kill('SIGTERM')
  })
  process.on('SIGINT', () => {
    state.child?.kill('SIGTERM')
    process.exit(0)
  })
}

async function startHost(options: Required<EnsureHostOptions>, state: HostState): Promise<void> {
  const cliPath = resolveCliEntry(options.appPath, options.cliPackage)
  const args = [
    cliPath,
    'dev',
    '--host',
    options.host,
    '--port',
    String(options.port),
    '--app',
    options.appPath,
  ]
  const runtime = resolveRuntime(options.runtime)
  if (options.debug) {
    console.info('[AgentConnect][Host] starting', { runtime, args })
  }

  const child = spawn(runtime, args, { stdio: options.debug ? 'pipe' : 'ignore' })
  state.child = child
  state.status = 'starting'
  registerCleanup(state)

  if (options.debug) {
    child.stdout?.on('data', (chunk) => {
      console.info('[AgentConnect][Host]', String(chunk).trim())
    })
    child.stderr?.on('data', (chunk) => {
      console.error('[AgentConnect][Host]', String(chunk).trim())
    })
  }

  child.on('error', (error) => {
    if (options.debug) {
      console.error('[AgentConnect][Host] spawn error', error)
    }
  })

  child.on('exit', () => {
    if (state.child === child) {
      state.status = 'idle'
      state.child = undefined
    }
  })

  const started = await waitForPort(options.host, options.port, child, options.timeoutMs)
  if (!started) {
    child.kill('SIGTERM')
    throw new Error('AgentConnect host failed to start. Ensure Node.js 20+ is installed.')
  }

  state.status = 'running'
}

export async function ensureAgentConnectHost(options: EnsureHostOptions = {}): Promise<void> {
  const state = getState()
  const resolvedOptions: Required<EnsureHostOptions> = {
    host: options.host || process.env.AGENTCONNECT_HOST || '127.0.0.1',
    port: options.port || Number(process.env.AGENTCONNECT_PORT || 9630),
    appPath: options.appPath || process.env.AGENTCONNECT_APP_PATH || process.cwd(),
    cliPackage: options.cliPackage || process.env.AGENTCONNECT_CLI_PACKAGE || '@agentconnect/cli',
    runtime: options.runtime || '',
    timeoutMs: options.timeoutMs || 8000,
    debug: options.debug ?? process.env.AGENTCONNECT_DEBUG === '1',
  }

  if (await isPortOpen(resolvedOptions.host, resolvedOptions.port)) {
    state.status = 'running'
    return
  }

  if (state.startPromise) return state.startPromise

  state.startPromise = startHost(resolvedOptions, state)
    .catch((error) => {
      state.status = 'idle'
      state.child = undefined
      throw error
    })
    .finally(() => {
      state.startPromise = undefined
    })

  return state.startPromise
}
