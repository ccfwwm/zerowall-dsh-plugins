import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SkillsProjectionApi, McpServerProjectionInput } from '../src/host/projection.js'
import type { ClaudeSelection, ClaudeRequestHeader } from '../src/host/route.js'

const broker = vi.hoisted(() => ({ get: vi.fn() }))
// Transport registration is outside this unit boundary. Run the real Host,
// route resolver and projectors against explicit session-scoped Host services.
vi.mock('@deepseek-ai/dsh-typert-protocol', () => ({
  Remote: (method: unknown) => method,
  TypertRemoteService: class {
    constructor(readonly ctx: Context) {}
  },
}))
vi.mock('@zerowallscience/plugin-secrets', () => ({
  SecretBrokerClient: class { get = broker.get },
}))

import { ClaudeCodeService } from '../src/host/index.js'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

type Launch = { argv: string[]; cwd: string; env: Record<string, string>; signal: AbortSignal }
type FakeTerminal = ReturnType<typeof terminal>
function terminal() {
  const completion = deferred<{ exitCode: number }>()
  const output = new PassThrough()
  const terminate = vi.fn(async () => { completion.resolve({ exitCode: 143 }) })
  return { output, done: completion.promise, terminate, finish: (exitCode = 0) => completion.resolve({ exitCode }) }
}

let directory: string
let cleanup: Array<() => Promise<unknown> | unknown>

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), 'zerowall-claude-host-'))
  cleanup = []
  vi.stubEnv('ZEROWALL_USER_DATA_DIR', directory)
  broker.get.mockReset().mockResolvedValue(undefined)
})
afterEach(async () => {
  await Promise.allSettled(cleanup.map(dispose => Promise.resolve().then(dispose)))
  vi.unstubAllEnvs()
  await rm(directory, { recursive: true, force: true, maxRetries: 3, retryDelay: 20 })
})

async function fixture() {
  const configDir = join(directory, 'private-runtime', 'config')
  const cli = join(directory, 'private-runtime', 'versions', 'current', 'claude.js')
  const runtime = {
    configDir,
    status: vi.fn(async () => ({ installed: true, version: '2.1.309', previousVersion: '2.1.309' })),
    getExecutablePath: vi.fn(async (): Promise<string | undefined> => cli),
    installOrUpdate: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    uninstall: vi.fn(async () => undefined),
    getCliEnvironment: vi.fn((turn: Record<string, string>, _unused: unknown, mcp: Record<string, string>) => ({
      CLAUDE_CONFIG_DIR: configDir, HOME: join(directory, 'private-runtime', 'home'), ...turn, ...mcp,
    })),
  }
  const selected = new Map<string, ClaudeSelection>()
  const loggedHeaders = new Map<string, ClaudeRequestHeader>()
  const workspaces = new Map<string, string>()
  const terminals: FakeTerminal[] = []
  const launches: Launch[] = []
  const servers: McpServerProjectionInput[] = []
  const credentials = vi.fn(async () => ({ value: 'host-only-route-secret-1234567890' }))
  const snapshot = vi.fn<SkillsProjectionApi['snapshot']>(async () => ({ complete: true, skills: [] }))
  const getSkill = vi.fn<SkillsProjectionApi['get']>(async () => undefined)
  const profile = { api: 'anthropic-messages', baseURL: 'https://provider.example.test/v1', apiKeyEnv: 'CLAUDE_TEST_KEY' }
  const managedRoute = vi.fn(async (_provider: string, model: string) => ({
    api: 'anthropic-messages', baseUrl: `https://${model}.example.test`,
  }))
  const managedCredential = vi.fn(async (_provider: string, model: string) => `host-only-key-for-${model}-1234567890`)
  const services: Record<string, unknown> = {
    agentDefaultModel: { currentSelection: vi.fn(() => ({ provider: 'custom-anthropic', model: 'fallback' })) },
    sessionProjections: { stateOf: vi.fn((session: { id: string }) => ({ pending: selected.get(session.id) })) },
    workingDirectory: { get: vi.fn((session: { id: string }) => workspaces.get(session.id)) },
    llm: { listConfigurableProviders: vi.fn(() => [{ provider: 'custom-anthropic', settingsNs: 'provider-settings', settingsPath: ['profile'] }]) },
    settings: { describe: vi.fn(() => [{ ns: 'provider-settings', value: { profile } }]) },
    credentials: { resolve: credentials },
    skills: { snapshot, get: getSkill },
    zerowallProjects: { listMcpServers: vi.fn(() => servers) },
    zerowallMcpRouteResolver: { resolve: managedRoute },
    zerowallAiCloudCredentialResolver: { resolve: managedCredential },
    subprocess: { spawnTerminal: vi.fn(async (launch: Launch) => {
      launches.push(launch)
      const handle = terminal()
      terminals.push(handle)
      return handle
    }) },
  }
  const effects: Array<() => unknown> = []
  const context = {
    get: (key: string) => services[key],
    inject: (keys: string[], callback: (scope: unknown) => unknown) => {
      if (keys.every(key => key in services)) callback(context)
    },
    effect: (effect: () => unknown) => { effects.push(effect) },
  }
  const host = new ClaudeCodeService(context as unknown as Context)
  // The runtime manager has its own filesystem/install contract tests. Inject
  // its process-free double here without launching pnpm or a real Claude CLI.
  Object.defineProperty(host, 'manager', { value: runtime })
  const agent = async (id: string) => {
    const cwd = join(directory, 'projects', id)
    workspaces.set(id, cwd)
    selected.set(id, { provider: 'custom-anthropic', model: `model-${id}` })
    await mkdir(cwd, { recursive: true })
    return { id, session: { id, requestHeader: () => loggedHeaders.get(id) }, ctx: context } as unknown as Agent
  }
  const finish = async (agent: Agent, index: number, code = 0) => {
    terminals[index]!.finish(code)
    await vi.waitFor(() => expect(host.read(agent)?.running).toBe(false))
  }
  cleanup.push(async () => {
    for (const handle of terminals) handle.finish(143)
    for (const effect of effects) {
      const dispose = effect()
      if (typeof dispose === 'function') await dispose()
    }
    await new Promise<void>(resolve => setImmediate(resolve))
  })
  return { host, runtime, agent, selected, loggedHeaders, workspaces, launches, terminals, servers, credentials,
    snapshot, getSkill, profile, services, managedRoute, managedCredential, configDir, cli, finish }
}

async function fileContents(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return []
    throw error
  })
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? fileContents(join(root, entry.name))
    : readFile(join(root, entry.name), 'utf8').then(text => [text])))).flat()
}

describe('Claude Code Host session boundary', () => {
  it('keeps status/read passive and only installs, rolls back or removes on explicit calls', async () => {
    const f = await fixture(), agent = await f.agent('install')
    expect(await f.host.status(agent)).toEqual({ desktop: true, installed: true, version: '2.1.309', rollbackAvailable: true, running: false })
    expect(f.host.read(agent)).toBeNull()
    expect(f.runtime.installOrUpdate).not.toHaveBeenCalled()
    expect(f.runtime.rollback).not.toHaveBeenCalled()
    expect(f.runtime.uninstall).not.toHaveBeenCalled()
    await f.host.install(agent)
    await f.host.rollback(agent)
    await f.host.uninstall(agent)
    expect(f.runtime.installOrUpdate).toHaveBeenCalledTimes(1)
    expect(f.runtime.rollback).toHaveBeenCalledTimes(1)
    expect(f.runtime.uninstall).toHaveBeenCalledTimes(1)
    expect(f.launches).toHaveLength(0)
  })

  it('hides CLI management and rejects runs outside Desktop without invoking the manager', async () => {
    const f = await fixture(), agent = await f.agent('web')
    vi.stubEnv('ZEROWALL_USER_DATA_DIR', '')
    expect(await f.host.status(agent)).toEqual({ desktop: false, installed: false, rollbackAvailable: false, running: false })
    await expect(f.host.start(agent, 'work')).rejects.toThrow('仅适用于 ZeroWall Desktop')
    await expect(f.host.install(agent)).rejects.toThrow('安装管理未完成')
    expect(f.runtime.getExecutablePath).not.toHaveBeenCalled()
    expect(f.runtime.installOrUpdate).not.toHaveBeenCalled()
  })

  it('re-resolves the current platform route and credentials for every new turn', async () => {
    const f = await fixture(), agent = await f.agent('switch')
    f.selected.set(agent.id, { provider: 'zerowall-ai-cloud-primary', model: 'model-a' })
    const first = await f.host.start(agent, 'first task')
    expect(first).toMatchObject({ provider: 'zerowall-ai-cloud-primary', model: 'model-a', running: true })
    expect(f.launches[0]?.env).toMatchObject({ ANTHROPIC_MODEL: 'model-a', ANTHROPIC_API_KEY: 'host-only-key-for-model-a-1234567890', ANTHROPIC_BASE_URL: 'https://model-a.example.test' })
    await f.finish(agent, 0)
    f.selected.set(agent.id, { provider: 'zerowall-ai-cloud-secondary', model: 'model-b', reasoningEffort: 'xhigh' })
    await f.host.start(agent, 'second task')
    expect(f.launches[1]?.env).toMatchObject({ ANTHROPIC_MODEL: 'model-b', ANTHROPIC_API_KEY: 'host-only-key-for-model-b-1234567890', ANTHROPIC_BASE_URL: 'https://model-b.example.test' })
    expect(f.managedRoute.mock.calls).toEqual([
      ['zerowall-ai-cloud-primary', 'model-a'], ['zerowall-ai-cloud-secondary', 'model-b'],
    ])
    expect(f.managedCredential).toHaveBeenCalledTimes(2)
    const effortIndex = f.launches[1]!.argv.indexOf('--effort')
    expect(effortIndex).toBeGreaterThan(0)
    expect(f.launches[1]!.argv[effortIndex + 1]).toBe('xhigh')
    expect(JSON.stringify(f.host.read(agent))).not.toContain('host-only-key')
  })

  it('restores the logged model without forwarding adapter-default effort and applies an explicit effort next turn', async () => {
    const f = await fixture(), agent = await f.agent('effort-ownership')
    f.selected.delete(agent.id)
    f.loggedHeaders.set(agent.id, {
      config: { provider: 'custom-anthropic', model: 'logged-claude', reasoningEffort: 'minimal' },
      adapterDefaults: { reasoningEffort: true },
    })
    await f.host.start(agent, 'use the conversation route')
    expect(f.launches[0]?.argv).toContain('logged-claude')
    expect(f.launches[0]?.argv).not.toContain('--effort')
    await f.finish(agent, 0)
    f.selected.set(agent.id, { provider: 'custom-anthropic', model: 'selected-claude', reasoningEffort: 'max' })
    await f.host.start(agent, 'use the explicit user choice')
    const next = f.launches[1]!.argv
    expect(next).toContain('selected-claude')
    expect(next[next.indexOf('--effort') + 1]).toBe('max')
    expect(f.loggedHeaders.get(agent.id)?.config.reasoningEffort).toBe('minimal')
  })

  it('rejects an explicitly logged unsupported effort before resolving credentials or spawning', async () => {
    const f = await fixture(), agent = await f.agent('unsupported-logged-effort')
    f.selected.delete(agent.id)
    f.loggedHeaders.set(agent.id, {
      config: { provider: 'custom-anthropic', model: 'logged-claude', reasoningEffort: 'minimal' },
    })
    await expect(f.host.start(agent, 'keep my explicit selection')).rejects.toThrow('推理强度不受此 Claude Code 版本支持')
    expect(f.credentials).not.toHaveBeenCalled()
    expect(f.launches).toHaveLength(0)
    expect(f.host.read(agent)).toBeNull()
  })

  it('isolates workspaces, projections and history between simultaneously running sessions', async () => {
    const f = await fixture(), a = await f.agent('project-a'), b = await f.agent('project-b')
    await f.host.start(a, 'private project A request')
    f.terminals[0]!.output.write('private project A result')
    await f.finish(a, 0)
    await f.host.start(a, 'continue A')
    await f.host.start(b, 'project B only')
    expect(f.launches[1]?.cwd).toBe(f.workspaces.get(a.id))
    expect(f.launches[2]?.cwd).toBe(f.workspaces.get(b.id))
    expect(f.launches[1]?.argv.at(-1)).toContain('private project A result')
    expect(f.launches[2]?.argv.at(-1)).toBe('project B only')
    const projection = (launch: Launch) => launch.argv[launch.argv.indexOf('--plugin-dir') + 1]!
    expect(projection(f.launches[1]!)).not.toBe(projection(f.launches[2]!))
    expect(projection(f.launches[1]!)).toContain(f.configDir)
    expect(f.snapshot).toHaveBeenCalledWith({ cwd: f.workspaces.get(a.id), scope: a })
    expect(f.snapshot).toHaveBeenCalledWith({ cwd: f.workspaces.get(b.id), scope: b })
    const view = f.host.read(a)!
    view.skipped.push('client mutation')
    view.output = 'client mutation'
    expect(f.host.read(a)?.skipped).not.toContain('client mutation')
    expect(f.host.read(b)?.model).toBe('model-project-b')
    const projectEntries = await readdir(f.workspaces.get(a.id)!)
    expect(projectEntries).toEqual([])
  })

  it('puts API and MCP secrets only in the child environment and redacts streamed output/history', async () => {
    const f = await fixture(), agent = await f.agent('secrets')
    const apiKey = 'host-only-route-secret-1234567890', mcpKey = 'host-only-mcp-secret-1234567890'
    broker.get.mockResolvedValue(mcpKey)
    f.servers.push({ name: 'tools', serverName: 'tools', transport: 'stdio', enabled: true,
      command: 'node', args: ['server.mjs'], cwd: '', envRefs: { API_TOKEN: 'MCP_TOKEN' }, headerRefs: {} })
    const sentinel = join(directory, 'existing-user-claude-config.json')
    await writeFile(sentinel, 'user configuration remains unchanged')
    await f.host.start(agent, 'inspect project')
    expect(f.launches[0]?.env.ANTHROPIC_API_KEY).toBe(apiKey)
    expect(Object.values(f.launches[0]!.env)).toContain(mcpKey)
    expect(f.launches[0]?.argv).toContain('acceptEdits')
    expect(f.launches[0]?.argv).toContain('--no-session-persistence')
    expect(f.launches[0]?.argv).toContain('mcp__tools__*')
    expect(f.launches[0]?.argv).not.toContain('mcp__*')
    expect(f.launches[0]?.argv.at(-2)).toBe('--')
    const config = (await fileContents(f.configDir)).join('\n')
    expect(config).toContain('${ZW_CLAUDE_MCP_')
    for (const secret of [apiKey, mcpKey]) {
      expect(config).not.toContain(secret)
      expect(JSON.stringify(f.launches[0]?.argv)).not.toContain(secret)
    }
    f.terminals[0]!.output.write(`api=${apiKey.slice(0, 12)}`)
    expect(f.host.read(agent)?.output).not.toContain(apiKey.slice(0, 12))
    f.terminals[0]!.output.write(`${apiKey.slice(12)};mcp=${mcpKey};done`)
    await f.finish(agent, 0)
    expect(f.host.read(agent)?.output).toBe('api=[REDACTED];mcp=[REDACTED];done')
    expect(JSON.stringify(await f.host.status(agent))).not.toContain(apiKey)
    await f.host.start(agent, 'next request')
    const history = f.launches[1]!.argv.at(-1)!
    expect(history).toContain('[REDACTED]')
    expect(history).not.toContain(apiKey)
    expect(history).not.toContain(mcpKey)
    expect(await readFile(sentinel, 'utf8')).toBe('user configuration remains unchanged')
    expect(broker.get).toHaveBeenCalledWith('zerowall.environment.var.mcp_token')
    expect((f.services.settings as { describe: ReturnType<typeof vi.fn> }).describe).toHaveBeenCalledWith({ redactSecrets: true })
  })

  it('authorizes every projected MCP server through one variadic option', async () => {
    const f = await fixture(), agent = await f.agent('many-mcp')
    for (const serverName of ['first', 'second']) {
      f.servers.push({ name: serverName, serverName, transport: 'stdio', enabled: true,
        command: 'node', args: ['server.mjs'], cwd: '', envRefs: {}, headerRefs: {} })
    }
    await f.host.start(agent, '--model is user text')
    const argv = f.launches[0]!.argv
    expect(argv.filter(arg => arg === '--allowedTools')).toHaveLength(1)
    expect(argv.slice(argv.indexOf('--allowedTools'))).toEqual([
      '--allowedTools', 'mcp__first__*', 'mcp__second__*', '--', '--model is user text',
    ])
  })

  it('wraps independent MCP directories within each turn projection and cleans them after completion', async () => {
    const f = await fixture(), agent = await f.agent('mcp-working-directory')
    const cwd = f.workspaces.get(agent.id)!
    for (const [serverName, workingDirectory] of [['same', cwd], ['inherited', ''], ['different', join(cwd, 'other')], ['relative', '.']] as const) {
      f.servers.push({ name: serverName, serverName, transport: 'stdio', enabled: true,
        command: 'node', args: ['server.mjs'], cwd: workingDirectory, envRefs: {}, headerRefs: {} })
    }
    const turn = await f.host.start(agent, 'inspect project')
    expect(turn.mcp).toBe(3)
    expect(turn.skipped).toEqual([
      'MCP relative: 工作目录无效：MCP 目录必须为空白或绝对目录。',
    ])
    const launch = f.launches[0]!
    expect(launch.cwd).toBe(cwd)
    expect(launch.argv).toContain('mcp__same__*')
    expect(launch.argv).toContain('mcp__inherited__*')
    expect(launch.argv).toContain('mcp__different__*')
    expect(launch.argv).not.toContain('mcp__relative__*')
    const config = JSON.parse(await readFile(launch.argv[launch.argv.indexOf('--mcp-config') + 1]!, 'utf8')) as { mcpServers: Record<string, unknown> }
    const launchers = Object.fromEntries(await Promise.all(['same', 'inherited', 'different'].map(async serverName => {
      const server = config.mcpServers[serverName] as { command: string; args: string[] }
      expect(server.command).toBe(process.execPath)
      expect(server.args[0]).toContain('mcp-launchers')
      return [serverName, JSON.parse(await readFile(server.args[1]!, 'utf8')) as Record<string, unknown>]
    })))
    expect(launchers.same).toEqual({ command: process.execPath, args: ['server.mjs'], cwd, env: {}, electron: false })
    expect(launchers.inherited).toEqual({ command: process.execPath, args: ['server.mjs'], cwd, env: {}, electron: false })
    expect(launchers.different).toEqual({ command: process.execPath, args: ['server.mjs'], cwd: join(cwd, 'other'), env: {}, electron: false })
    expect(f.servers.map(server => server.cwd)).toEqual([cwd, '', join(cwd, 'other'), '.'])
    await f.finish(agent, 0)
    await vi.waitFor(async () => expect(await fileContents(f.configDir)).toEqual([]))
  })

  it('rejects incompatible protocols, missing installs and relative workspaces before spawning', async () => {
    const f = await fixture(), agent = await f.agent('invalid')
    f.profile.api = 'openai-completions'
    await expect(f.host.start(agent, 'work')).rejects.toThrow('Anthropic Messages')
    f.profile.api = 'anthropic-messages'
    f.runtime.getExecutablePath.mockResolvedValueOnce(undefined)
    await expect(f.host.start(agent, 'work')).rejects.toThrow('请先安装')
    f.workspaces.set(agent.id, 'relative-workspace')
    await expect(f.host.start(agent, 'work')).rejects.toThrow('有效的项目目录')
    expect(f.launches).toHaveLength(0)
    expect(f.runtime.installOrUpdate).not.toHaveBeenCalled()
    expect(f.host.read(agent)).toBeNull()
  })

  it('rejects concurrent preparation/installation and releases the install lock after failure', async () => {
    const f = await fixture(), agent = await f.agent('locks')
    const preparation = deferred<string | undefined>()
    f.runtime.getExecutablePath.mockReturnValueOnce(preparation.promise)
    const pending = f.host.start(agent, 'first')
    await expect(f.host.start(agent, 'second')).rejects.toThrow('正在运行')
    await expect(f.host.install(agent)).rejects.toThrow('请先停止')
    preparation.resolve(f.cli)
    await pending
    await f.finish(agent, 0)
    const installation = deferred<undefined>()
    f.runtime.installOrUpdate.mockReturnValueOnce(installation.promise)
    const installing = f.host.install(agent)
    await expect(f.host.start(agent, 'during install')).rejects.toThrow('正在运行')
    await expect(f.host.uninstall(agent)).rejects.toThrow('请先停止')
    installation.reject(new Error('untrusted installer credentials must stay private'))
    await expect(installing).rejects.toThrow('安装管理未完成')
    await expect(f.host.install(agent)).resolves.toMatchObject({ installed: true })
  })

  it('stops only the owning session and clears history only after completion', async () => {
    const f = await fixture(), a = await f.agent('stop-a'), b = await f.agent('stop-b')
    await f.host.start(a, 'A work')
    await f.host.start(b, 'B work')
    expect(await f.host.status(a)).toMatchObject({ running: true })
    expect(() => f.host.clear(a)).toThrow('请先停止')
    await f.host.stop(a)
    expect(f.launches[0]?.signal.aborted).toBe(true)
    expect(f.terminals[0]?.terminate).toHaveBeenCalledOnce()
    expect(f.terminals[1]?.terminate).not.toHaveBeenCalled()
    expect(f.host.read(b)?.running).toBe(true)
    await vi.waitFor(() => expect(f.host.read(a)?.running).toBe(false))
    f.host.clear(a)
    expect(f.host.read(a)).toBeNull()
    await f.host.start(a, 'fresh A request')
    expect(f.launches[2]?.argv.at(-1)).toBe('fresh A request')
  })

  it('reports preparation as running and can stop it before any process or projection exists', async () => {
    const f = await fixture(), a = await f.agent('prepare-a'), b = await f.agent('prepare-b')
    const preparation = deferred<string | undefined>()
    f.runtime.getExecutablePath.mockReturnValueOnce(preparation.promise)
    const pending = f.host.start(a, 'preparing task')
    const rejected = expect(pending).rejects.toThrow('任务已停止')
    expect(await f.host.status(a)).toMatchObject({ running: true })
    expect(await f.host.status(b)).toMatchObject({ running: false })
    expect(() => f.host.clear(a)).toThrow('请先停止')
    await f.host.stop(a)
    preparation.resolve(f.cli)
    await rejected
    expect(f.launches).toHaveLength(0)
    expect(await fileContents(f.configDir)).toEqual([])
    expect(await f.host.status(a)).toMatchObject({ running: false })
    await expect(f.host.start(a, 'retry after cancellation')).resolves.toMatchObject({ running: true })
  })

  it('removes projection files after a preparation error or subprocess launch failure', async () => {
    const f = await fixture(), agent = await f.agent('cleanup')
    f.runtime.getCliEnvironment.mockImplementationOnce(() => { throw new Error('private environment error') })
    await expect(f.host.start(agent, 'prepare failure')).rejects.toThrow('无法准备当前会话')
    expect(await fileContents(f.configDir)).toEqual([])
    expect(await f.host.status(agent)).toMatchObject({ running: false })
    const subprocess = f.services.subprocess as { spawnTerminal: ReturnType<typeof vi.fn> }
    subprocess.spawnTerminal.mockRejectedValueOnce(new Error('private subprocess error'))
    await expect(f.host.start(agent, 'launch failure')).resolves.toMatchObject({ running: false, message: 'Claude Code 无法启动，请检查安装状态后重试。' })
    expect(await fileContents(f.configDir)).toEqual([])
    expect(JSON.stringify(f.host.read(agent))).not.toContain('private subprocess')
    await expect(f.host.start(agent, 'retry after launch failure')).resolves.toMatchObject({ running: true })
  })

  it('cancels a pending subprocess launch and removes its session projection', async () => {
    const f = await fixture(), agent = await f.agent('pending-launch')
    const subprocess = f.services.subprocess as { spawnTerminal: ReturnType<typeof vi.fn> }
    let launchSignal: AbortSignal | undefined
    subprocess.spawnTerminal.mockImplementationOnce((launch: Launch) => {
      launchSignal = launch.signal
      return new Promise((_resolve, reject) => {
        launch.signal.addEventListener('abort', () => reject(new Error('aborted launch')), { once: true })
      })
    })
    const pending = f.host.start(agent, 'cancel while spawning')
    await vi.waitFor(() => expect(launchSignal).toBeDefined())
    expect(await f.host.status(agent)).toMatchObject({ running: true })
    expect((await fileContents(f.configDir)).length).toBeGreaterThan(0)
    await f.host.stop(agent)
    await expect(pending).resolves.toMatchObject({ running: false })
    expect(launchSignal?.aborted).toBe(true)
    expect(await fileContents(f.configDir)).toEqual([])
    expect(await f.host.status(agent)).toMatchObject({ running: false })
  })
})
