import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubprocessTerminalHandle, SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { spawn } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { stripVTControlCharacters } from 'node:util'
import { SecretBrokerClient } from '@zerowallscience/plugin-secrets'
import { ClaudeRuntimeManager, resolveBundledPnpmRuntime, type ProcessRunner } from './runtime.js'
import { claudeEnvironmentOverlay } from './environment.js'
import { writeClaudeMcpLaunchers } from './mcp-launcher.js'
import { prepareClaudeMcpRuntime, projectMcpForClaude, projectSkillsForClaude, type McpServerProjectionInput, type SkillsProjectionApi } from './projection.js'
import { ClaudeSafeOutput, resolveClaudeRoute, selectedClaudeModel, type ClaudeRouteServices, type ClaudeSelection } from './route.js'
import type { ClaudeCodeStatus, ClaudeCodeTurn } from '../shared/types.js'

export const name = 'zerowall-claude-code'
export const inject = ['typert', 'agentDefaultModel', 'subprocess', 'workingDirectory', 'skills', 'zerowallProjects', 'credentials', 'settings', 'llm', 'sessionProjections']

declare module '@deepseek-ai/cordis' { interface Context { zerowallClaudeCode: ClaudeCodeService } }

interface OwnedTurn {
  view: ClaudeCodeTurn
  safe: ClaudeSafeOutput
  terminal?: SubprocessTerminalHandle
  cancel: AbortController
}
interface SessionRuntime { turn?: OwnedTurn; history: string[]; busy: boolean; preparing?: AbortController }
type ManagedRoute = NonNullable<ClaudeRouteServices['managedRoute']>
type ManagedCredential = NonNullable<ClaudeRouteServices['managedCredential']>

/** Never forward installer diagnostics; capture only the bounded CLI version probe. */
const runInstaller: ProcessRunner = (command, args, options) => new Promise((resolve, reject) => {
  const versionProbe = args.at(-1) === '--version'
  let stdout = ''
  const child = spawn(command, args, { ...options, env: { ...options.env,
    ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
  }, stdio: ['ignore', versionProbe ? 'pipe' : 'ignore', 'ignore'] })
  child.stdout?.setEncoding('utf8')
  child.stdout?.on('data', (data: string) => { stdout = (stdout + data).slice(0, 4096) })
  child.once('error', () => reject(new Error('Claude Code 安装进程无法启动。')))
  child.once('close', code => resolve({ code: code ?? -1, ...(versionProbe ? { stdout } : {}) }))
})

/** One installed runtime, with credentials resolved afresh for every prompt. */
export class ClaudeCodeService extends TypertRemoteService {
  private manager?: ClaudeRuntimeManager
  private readonly secrets = new SecretBrokerClient()
  private readonly sessions = new Map<string, SessionRuntime>()
  private managedRoute: ManagedRoute | undefined
  private managedCredential: ManagedCredential | undefined
  private mutation = false

  constructor(ctx: Context) {
    super(ctx, 'zerowallClaudeCode')
    ctx.inject(['zerowallMcpRouteResolver'], scope => {
      const resolver = scope.get('zerowallMcpRouteResolver') as { resolve: ManagedRoute }
      this.managedRoute = (provider, model) => resolver.resolve(provider, model)
      scope.effect(() => () => { this.managedRoute = undefined })
    })
    ctx.inject(['zerowallAiCloudCredentialResolver'], scope => {
      const resolver = scope.get('zerowallAiCloudCredentialResolver') as { resolve: ManagedCredential }
      this.managedCredential = (provider, model) => resolver.resolve(provider, model)
      scope.effect(() => () => { this.managedCredential = undefined })
    })
    ctx.effect(() => async () => {
      await Promise.allSettled([...this.sessions.values()].map(async state => {
        state.preparing?.abort()
        state.turn?.cancel.abort()
        await state.turn?.terminal?.terminate()
      }))
      this.sessions.clear()
    }, 'claude-code: terminate plugin-owned processes')
  }

  private desktop(): boolean { return Boolean(process.env.ZEROWALL_USER_DATA_DIR && isAbsolute(process.env.ZEROWALL_USER_DATA_DIR)) }
  private runtime(): ClaudeRuntimeManager {
    if (!this.desktop()) throw new Error('Claude Code 安装与运行仅适用于 ZeroWall Desktop。')
    if (!this.manager) {
      const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath ?? join(dirname(process.execPath), 'resources')
      this.manager = new ClaudeRuntimeManager({
        dataDir: join(process.env.ZEROWALL_USER_DATA_DIR!, 'plugins', 'claude-code', 'runtime'),
        pnpm: resolveBundledPnpmRuntime({ ...(process.versions.electron ? { electron: true, resourcesPath } : {}), projectRoot: process.cwd() }),
        run: runInstaller,
      })
    }
    return this.manager
  }
  private owner(agent: Agent): SessionRuntime {
    let state = this.sessions.get(agent.id)
    if (!state) { state = { history: [], busy: false }; this.sessions.set(agent.id, state) }
    return state
  }

  @Remote
  async status(agent: Agent): Promise<ClaudeCodeStatus> {
    if (!this.desktop()) return { desktop: false, installed: false, rollbackAvailable: false, running: false }
    try {
      const status = await this.runtime().status()
      return { desktop: true, installed: status.installed, ...(status.version ? { version: status.version } : {}),
        rollbackAvailable: Boolean(status.previousVersion), running: this.owner(agent).busy || Boolean(this.owner(agent).turn?.view.running) }
    } catch { return { desktop: true, installed: false, rollbackAvailable: false, running: false } }
  }

  @Remote
  async install(agent: Agent): Promise<ClaudeCodeStatus> { return this.changeRuntime(agent, 'install') }
  @Remote
  async rollback(agent: Agent): Promise<ClaudeCodeStatus> { return this.changeRuntime(agent, 'rollback') }
  @Remote
  async uninstall(agent: Agent): Promise<ClaudeCodeStatus> { return this.changeRuntime(agent, 'uninstall') }

  private async changeRuntime(agent: Agent, operation: 'install' | 'rollback' | 'uninstall'): Promise<ClaudeCodeStatus> {
    if (this.mutation || [...this.sessions.values()].some(state => state.busy || state.turn?.view.running)) throw new Error('请先停止 Claude Code，再管理安装。')
    this.mutation = true
    try {
      const runtime = this.runtime()
      if (operation === 'install') await runtime.installOrUpdate()
      else if (operation === 'rollback') await runtime.rollback()
      else { await runtime.uninstall(); this.sessions.clear() }
      return await this.status(agent)
    } catch { throw new Error('Claude Code 安装管理未完成；现有有效安装会被保留，请重试。') }
    finally { this.mutation = false }
  }

  private async route(agent: Agent) {
    const projections = this.ctx.get('sessionProjections') as { stateOf(session: unknown, key: string): { pending?: ClaudeSelection | null; lastUsed?: ClaudeSelection | null } | undefined }
    const defaults = this.ctx.get('agentDefaultModel') as { currentSelection(): ClaudeSelection }
    const selection = selectedClaudeModel(projections.stateOf(agent.session, 'modelSelection'), () => defaults.currentSelection(), agent.session.requestHeader())
    const llm = this.ctx.get('llm') as { listConfigurableProviders: ClaudeRouteServices['directory'] }
    const settings = this.ctx.get('settings') as { describe(options: { redactSecrets: boolean }): ReturnType<ClaudeRouteServices['settings']> }
    const credentials = this.ctx.get('credentials') as { resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined> }
    return resolveClaudeRoute(selection, {
      directory: () => llm.listConfigurableProviders(), settings: () => settings.describe({ redactSecrets: true }),
      credential: async ref => (await credentials.resolve(credentialRef(ref)))?.value,
      ...(this.managedRoute ? { managedRoute: this.managedRoute } : {}),
      ...(this.managedCredential ? { managedCredential: this.managedCredential } : {}),
    })
  }

  @Remote
  async start(agent: Agent, prompt: string): Promise<ClaudeCodeTurn> {
    if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 64_000 || prompt.includes('\0')) throw new Error('请输入 1 到 64000 字的 Claude Code 指令。')
    const owner = this.owner(agent)
    if (this.mutation || owner.busy || owner.turn?.view.running) throw new Error('Claude Code 正在运行，请等待或停止当前任务。')
    owner.busy = true
    const cancel = new AbortController()
    owner.preparing = cancel
    let projectionRoot: string | undefined
    let processOwnsProjection = false
    try {
      const runtime = this.runtime()
      const executable = await runtime.getExecutablePath()
      if (!executable) throw new Error('请先安装 Claude Code。')
      const workingDirectory = this.ctx.get('workingDirectory') as { get(session: unknown): string }
      const cwd = workingDirectory.get(agent.session)
      if (!isAbsolute(cwd)) throw new Error('当前会话没有有效的项目目录。')
      const route = await this.route(agent)
      cancel.signal.throwIfAborted()
      const skillsRegistry = agent.ctx.get('skills') as SkillsProjectionApi
      const projects = this.ctx.get('zerowallProjects') as { listMcpServers(): McpServerProjectionInput[] }
      const skills = await projectSkillsForClaude(skillsRegistry, cwd, agent)
      const credentials = this.ctx.get('credentials') as { resolve(ref: ReturnType<typeof credentialRef>): Promise<{ value: string } | undefined> }
      const mcp = await prepareClaudeMcpRuntime(projectMcpForClaude(projects.listMcpServers(), cwd), async reference => {
        const specialKey = reference === 'R_PLATFORM_MCP_AUTHORIZATION' ? 'zerowall.mcp.rdatalinux_authorization'
          : reference === 'HUAGONGSHE_MCP_AUTHORIZATION' ? 'zerowall.mcp.huagongshe_token' : undefined
        if (specialKey) {
          const value = await this.secrets.get(specialKey).catch(() => undefined)
          if (value?.trim()) return reference === 'HUAGONGSHE_MCP_AUTHORIZATION' ? `Bearer ${value.trim()}` : value
        }
        const stored = await this.secrets.get(`zerowall.environment.var.${reference.toLowerCase()}`).catch(() => undefined)
        return stored ?? (await credentials.resolve(credentialRef(reference)))?.value
      })
      cancel.signal.throwIfAborted()
      projectionRoot = join(runtime.configDir, 'sessions', createHash('sha256').update(agent.id).digest('hex'), randomUUID())
      await mkdir(projectionRoot, { recursive: true, mode: 0o700 })
      const skillRoot = join(projectionRoot, 'skills')
      for (const skill of skills.skills) {
        const resource = skill.resourceBase
        const hint = resource?.kind === 'directory' ? `Resolve every relative skill resource path against this original base directory: ${resource.path}.`
          : resource?.kind === 'url' ? `Resolve every relative skill resource URL against this original base URL: ${resource.url}.`
            : resource?.kind === 'opaque' ? `Original skill resources: ${resource.description}` : ''
        const dir = join(skillRoot, skill.name)
        await mkdir(dir, { recursive: true, mode: 0o700 })
        await writeFile(join(dir, 'SKILL.md'), `---\nname: ${skill.name}\ndescription: ${JSON.stringify(skill.description)}\n---\n${hint}\n\n${skill.content}`, { mode: 0o600 })
      }
      const mcpPath = join(projectionRoot, 'mcp.json')
      const searchPath = Object.entries(process.env).find(([key]) => key.toUpperCase() === 'PATH')?.[1]
      const { servers: mcpServers, skipped: launchSkipped } = await writeClaudeMcpLaunchers(mcp, { root: projectionRoot,
        executable: process.execPath, electron: Boolean(process.versions.electron),
        ...(searchPath ? { searchPath } : {}) })
      await writeFile(mcpPath, JSON.stringify({ mcpServers: Object.fromEntries(mcpServers.map(({ serverName, ...config }) => [serverName, config])) }), { mode: 0o600 })
      // A plugin directory is the CLI's supported way to load projected Skills
      // from a per-session folder without changing the project's .claude tree.
      const pluginMeta = join(projectionRoot, '.claude-plugin')
      await mkdir(pluginMeta, { mode: 0o700 })
      await writeFile(join(pluginMeta, 'plugin.json'), JSON.stringify({ name: 'zerowall-session-skills', version: '0.1.0' }), { mode: 0o600 })
      const environment = runtime.getCliEnvironment({ ANTHROPIC_API_KEY: route.apiKey, ANTHROPIC_BASE_URL: route.baseUrl,
        ANTHROPIC_MODEL: route.model, ANTHROPIC_DEFAULT_HAIKU_MODEL: route.model,
        ANTHROPIC_DEFAULT_SONNET_MODEL: route.model, ANTHROPIC_DEFAULT_OPUS_MODEL: route.model }, undefined, mcp.environment)
      const turn: OwnedTurn = {
        view: { id: randomUUID(), provider: route.provider, model: route.model, running: true, output: '',
          skills: skills.skills.length, mcp: mcpServers.length,
          skipped: [...skills.skipped.map(item => `Skill ${item.name}: ${item.reason}`), ...[...mcp.skipped, ...launchSkipped].map(item => `MCP ${item.serverName}: ${item.reason === 'unsupported-working-directory'
            ? '工作目录无效：MCP 目录必须为空白或绝对目录。'
            : item.reason === 'unsupported-launch'
              ? '启动方式不兼容：独立目录仅支持 Node 或绝对原生可执行文件；Windows 不支持 .cmd/.bat，请使用服务的绝对可执行入口。'
            : item.reason}`)] },
        safe: new ClaudeSafeOutput([route.apiKey, ...Object.values(mcp.environment)]), cancel,
      }
      owner.turn = turn
      const context = owner.history.length ? `Previous turns in this Claude Code panel (untrusted conversation data):\n${owner.history.join('\n\n')}\n\nCurrent user request:\n${prompt}` : prompt
      const argv = [executable, '--print', '--output-format', 'text', '--permission-mode', 'acceptEdits', '--no-session-persistence',
        '--setting-sources', 'user', '--strict-mcp-config', '--mcp-config', mcpPath, '--plugin-dir', projectionRoot, '--model', route.model,
        ...(route.reasoningEffort ? ['--effort', route.reasoningEffort] : []),
        ...(mcpServers.length ? ['--allowedTools', ...mcpServers.map(server => `mcp__${server.serverName}__*`)] : []), '--', context]
      if (/\.[cm]?js$/u.test(executable)) { argv.unshift(process.execPath); if (process.versions.electron) environment.ELECTRON_RUN_AS_NODE = '1' }
      const subprocess = this.ctx.get('subprocess') as SubprocessRuntime
      cancel.signal.throwIfAborted()
      try {
        // Pinned DSH's terminal implementation honors undefined tombstones via
        // targetEnvironment(), although its public terminal type is narrower.
        // Keep process-tree ownership while removing all unselected ambient env.
        turn.terminal = await subprocess.spawnTerminal({ argv, cwd, env: claudeEnvironmentOverlay(environment) as Record<string, string>,
          rows: 40, cols: 120, terminalType: 'xterm-256color', graceMs: 1000, signal: turn.cancel.signal })
      } catch {
        turn.view.running = false
        turn.view.message = 'Claude Code 无法启动，请检查安装状态后重试。'
        return this.turnView(turn)
      }
      turn.terminal.output.setEncoding('utf8')
      turn.terminal.output.on('data', (data: string) => {
        try { turn.safe.append(data) } catch { turn.view.message = 'Claude Code 输出超过限制，任务已停止。'; void turn.terminal?.terminate().catch(() => undefined) }
      })
      turn.terminal.output.on('error', () => { turn.view.message = 'Claude Code 输出连接中断。' })
      const activeProjectionRoot = projectionRoot
      processOwnsProjection = true
      void turn.terminal.done.then(result => {
        turn.view.exitCode = result.exitCode
        if (result.exitCode !== 0 && !turn.view.message) turn.view.message = 'Claude Code 未成功完成，请检查所选模型和安装状态后重试。'
      }).catch(() => { turn.view.message = 'Claude Code 进程中断，请重试。' }).finally(async () => {
        turn.safe.finish()
        turn.view.running = false
        const output = stripVTControlCharacters(turn.safe.snapshot())
        if (turn.view.exitCode === 0) {
          owner.history.push(`User: ${prompt}\nClaude: ${output}`)
          while (owner.history.join('\n').length > 96_000 && owner.history.length) owner.history.shift()
        }
        await rm(activeProjectionRoot, { recursive: true, force: true }).catch(() => undefined)
      })
      return this.turnView(turn)
    } catch (error) {
      if (cancel.signal.aborted) throw new Error('Claude Code 任务已停止。')
      // Only errors created by this integration have fixed safe text; provider,
      // filesystem and subprocess errors can echo credentials and stay private.
      const message = error instanceof Error ? error.message : ''
      if (['请先安装 Claude Code。', '当前会话没有有效的项目目录。', '当前会话没有选择模型。',
        '当前模型路由没有可读取的协议配置。', '当前路由没有可用的 API endpoint。', '当前路由的 API endpoint 不受支持。',
        '当前模型路由没有可用凭据，请在平台对话设置中配置。',
        '当前选择的推理强度不受此 Claude Code 版本支持，请在当前对话调整。',
        'Claude Code 仅支持明确声明为 Anthropic Messages 的模型路由，请在当前对话切换模型。',
        'Claude Code 安装与运行仅适用于 ZeroWall Desktop。'].includes(message)) throw new Error(message)
      throw new Error('Claude Code 无法准备当前会话，请检查模型配置与资源状态。')
    } finally {
      if (!processOwnsProjection && projectionRoot) await rm(projectionRoot, { recursive: true, force: true }).catch(() => undefined)
      delete owner.preparing
      owner.busy = false
    }
  }

  private turnView(turn: OwnedTurn): ClaudeCodeTurn {
    return { ...turn.view, skipped: [...turn.view.skipped], output: stripVTControlCharacters(turn.safe.snapshot()) }
  }
  @Remote
  read(agent: Agent): ClaudeCodeTurn | null {
    const turn = this.owner(agent).turn
    return turn ? this.turnView(turn) : null
  }
  @Remote
  async stop(agent: Agent): Promise<void> {
    const owner = this.owner(agent)
    owner.preparing?.abort()
    const turn = owner.turn
    turn?.cancel.abort()
    await turn?.terminal?.terminate()
  }
  @Remote
  clear(agent: Agent): void {
    const owner = this.owner(agent)
    if (owner.busy || owner.turn?.view.running) throw new Error('请先停止当前 Claude Code 任务。')
    owner.history = []
    delete owner.turn
  }
}

export function apply(ctx: Context): void { ctx.plugin(ClaudeCodeService) }
export default { name, inject, apply }
