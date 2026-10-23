import { describe, expect, it, vi } from 'vitest'
import {
  projectMcpForClaude,
  prepareClaudeMcpRuntime,
  projectSkillsForClaude,
  type McpServerProjectionInput,
  type SkillDefinitionProjectionInput,
  type SkillSummaryProjectionInput,
} from '../src/host/projection.js'

const skillSummary = (overrides: Partial<SkillSummaryProjectionInput> = {}): SkillSummaryProjectionInput => ({
  name: 'safe-skill',
  description: 'A valid skill',
  invocation: { modelInvocable: true },
  ...overrides,
})

const skillDefinition = (overrides: Partial<SkillDefinitionProjectionInput> = {}): SkillDefinitionProjectionInput => ({
  ...skillSummary(),
  content: '# Instructions\nDo useful work.',
  ...overrides,
})

const mcpServer = (overrides: Partial<McpServerProjectionInput> = {}): McpServerProjectionInput => ({
  name: 'Local tools',
  serverName: 'local-tools',
  transport: 'stdio',
  enabled: true,
  command: 'node',
  args: ['server.js'],
  cwd: '/workspace',
  envRefs: {},
  headerRefs: {},
  ...overrides,
})

describe('Claude Code resource projections', () => {
  it('projects only effective model-invocable Skills after loading current definitions', async () => {
    const api = {
      snapshot: vi.fn().mockResolvedValue({
        complete: true,
        skills: [skillSummary(), skillSummary({ name: 'user-only', invocation: { modelInvocable: false } })],
      }),
      get: vi.fn(async (name: string) => name === 'safe-skill'
        ? skillDefinition({ whenToUse: 'When the task needs it.' })
        : undefined),
    }

    const result = await projectSkillsForClaude(api, '/workspace')

    expect(api.snapshot).toHaveBeenCalledWith({ cwd: '/workspace' })
    expect(api.get).toHaveBeenCalledTimes(1)
    expect(api.get).toHaveBeenCalledWith('safe-skill', { cwd: '/workspace' })
    expect(result.skills).toEqual([{
      name: 'safe-skill',
      description: 'A valid skill',
      content: '# Instructions\nDo useful work.',
      whenToUse: 'When the task needs it.',
    }])
    expect(result.skipped).toEqual([{ name: 'user-only', reason: 'not-model-invocable' }])
  })

  it('refuses an incomplete catalog and fails closed for stale or invalid definitions', async () => {
    const incomplete = {
      snapshot: vi.fn().mockResolvedValue({ complete: false, skills: [skillSummary()] }),
      get: vi.fn(),
    }
    await expect(projectSkillsForClaude(incomplete, '/workspace')).rejects.toThrow(/catalog is incomplete/u)
    expect(incomplete.get).not.toHaveBeenCalled()
    const providerFailure = {
      snapshot: vi.fn().mockRejectedValue(new Error('sensitive provider path')), get: vi.fn(),
    }
    await expect(projectSkillsForClaude(providerFailure, '/workspace'))
      .rejects.toThrow('The current Skills catalog could not be read; Claude Code projection was not updated.')

    const complete = {
      snapshot: vi.fn().mockResolvedValue({ complete: true, skills: [
        skillSummary(),
        skillSummary({ name: 'bad-name!' }),
      ] }),
      get: vi.fn(async (name: string) => name === 'safe-skill'
        ? skillDefinition({ invocation: { modelInvocable: false } })
        : undefined),
    }
    const result = await projectSkillsForClaude(complete, '/workspace')
    expect(result.skills).toEqual([])
    expect(result.skipped).toEqual([
      { name: 'safe-skill', reason: 'invalid-definition' },
      { name: 'bad-name!', reason: 'invalid-summary' },
    ])
  })

  it('uses each viewing agent scope for both catalog and body reads', async () => {
    const firstAgent = { session: 'first' }
    const secondAgent = { session: 'second' }
    const api = {
      snapshot: vi.fn(async (options?: { cwd?: string; scope?: object }) => ({
        complete: true,
        skills: options?.scope === firstAgent || options?.scope === secondAgent ? [skillSummary()] : [],
      })),
      get: vi.fn(async (_name: string, options?: { cwd?: string; scope?: object }) => {
        if (options?.scope === firstAgent) return skillDefinition({ content: 'First agent overlay.' })
        if (options?.scope === secondAgent) return skillDefinition({ content: 'Second agent overlay.' })
        return undefined
      }),
    }

    const first = await projectSkillsForClaude(api, '/workspace', firstAgent)
    const second = await projectSkillsForClaude(api, '/workspace', secondAgent)

    expect(first.skills[0]?.content).toBe('First agent overlay.')
    expect(second.skills[0]?.content).toBe('Second agent overlay.')
    expect(api.snapshot).toHaveBeenNthCalledWith(1, { cwd: '/workspace', scope: firstAgent })
    expect(api.snapshot).toHaveBeenNthCalledWith(2, { cwd: '/workspace', scope: secondAgent })
    expect(api.get).toHaveBeenNthCalledWith(1, 'safe-skill', { cwd: '/workspace', scope: firstAgent })
    expect(api.get).toHaveBeenNthCalledWith(2, 'safe-skill', { cwd: '/workspace', scope: secondAgent })
    expect(api.snapshot.mock.calls[0]?.[0]?.scope).toBe(firstAgent)
    expect(api.get.mock.calls[1]?.[1]?.scope).toBe(secondAgent)
  })

  it('skips unavailable bodies without exposing partial catalog entries', async () => {
    const api = {
      snapshot: vi.fn().mockResolvedValue({ complete: true, skills: [skillSummary()] }),
      get: vi.fn().mockRejectedValue(new Error('private provider detail')),
    }
    const result = await projectSkillsForClaude(api, '/workspace')
    expect(result).toEqual({ skills: [], skipped: [{ name: 'safe-skill', reason: 'unavailable' }] })
    expect(JSON.stringify(result)).not.toContain('private provider detail')
  })

  it('projects eligible stdio launches and rejects disabled, managed or invalid records', () => {
    const result = projectMcpForClaude([
      mcpServer(),
      mcpServer({ serverName: 'disabled', enabled: false }),
      mcpServer({ serverName: 'remote', transport: 'sse' }),
      mcpServer({ serverName: 'managed', command: 'zerowall-managed:bio-tools' }),
      mcpServer({ serverName: 'secret', envRefs: { API_TOKEN: 'vault://mcp/api-token/sentinel' } }),
      mcpServer({ serverName: 'header-secret', headerRefs: { Authorization: 'vault://mcp/auth/sentinel' } }),
      mcpServer({ serverName: 'bad/name' }),
    ])

    expect(result.servers).toEqual([{
      serverName: 'local-tools',
      type: 'stdio',
      command: 'node',
      args: ['server.js'],
      cwd: '/workspace',
      envRefs: {},
    }])
    expect(result.skipped.map(item => [item.serverName, item.reason])).toEqual([
      ['disabled', 'disabled'],
      ['remote', 'unsupported-transport'],
      ['managed', 'managed-server'],
      ['secret', 'invalid-credential-reference'],
      ['header-secret', 'credential-reference'],
      ['bad/name', 'invalid-launch'],
    ])
    expect(JSON.stringify(result)).not.toContain('vault://mcp/')
  })

  it('rejects duplicate names and NUL-bearing launch arguments', () => {
    const result = projectMcpForClaude([
      mcpServer(),
      mcpServer({ name: 'duplicate', command: 'other' }),
      mcpServer({ serverName: 'nul-arg', args: ['--token\0secret'] }),
      mcpServer({ serverName: 'nul-command', command: 'bad\0command' }),
    ])
    expect(result.servers).toEqual([])
    expect(result.skipped.map(item => item.reason)).toEqual([
      'duplicate-server-name',
      'duplicate-server-name',
      'invalid-launch',
      'invalid-launch',
    ])
  })

  it('retains the resource base from the same loaded Skill definition', async () => {
    const resourceBase = { kind: 'directory' as const, path: '/original/skill' }
    const api = {
      snapshot: vi.fn().mockResolvedValue({ complete: true, skills: [skillSummary()] }),
      get: vi.fn().mockResolvedValue(skillDefinition({ resourceBase })),
    }
    expect((await projectSkillsForClaude(api, '/workspace')).skills[0]?.resourceBase).toEqual(resourceBase)
    expect(api.get).toHaveBeenCalledOnce()
  })

  it('projects enabled independent HTTP services with normalized URLs and opaque header references', async () => {
    const projection = projectMcpForClaude([
      mcpServer({ serverName: 'remote', transport: 'streamable-http', url: 'HTTPS://MCP.EXAMPLE:443/tools', headerRefs: { Authorization: 'REMOTE_AUTH' } }),
      mcpServer({ serverName: 'public', transport: 'streamable-http', url: 'http://localhost:3210/mcp' }),
    ])
    expect(projection.skipped).toEqual([])
    expect(projection.servers).toEqual([
      { serverName: 'remote', type: 'http', url: 'https://mcp.example/tools', headerRefs: { Authorization: 'REMOTE_AUTH' } },
      { serverName: 'public', type: 'http', url: 'http://localhost:3210/mcp', headerRefs: {} },
    ])
    const resolve = vi.fn(async () => 'Bearer private-http-token')
    const runtime = await prepareClaudeMcpRuntime(projection, resolve)
    expect(resolve).toHaveBeenCalledExactlyOnceWith('REMOTE_AUTH')
    expect(runtime.servers[0]).toMatchObject({ serverName: 'remote', type: 'http', url: 'https://mcp.example/tools', headers: { Authorization: expect.stringMatching(/^\$\{ZW_CLAUDE_MCP_[0-9A-F]{20}\}$/u) } })
    expect(runtime.servers[1]).toEqual({ serverName: 'public', type: 'http', url: 'http://localhost:3210/mcp' })
    expect(Object.values(runtime.environment)).toEqual(['Bearer private-http-token'])
    expect(JSON.stringify(runtime.servers)).not.toContain('private-http-token')
    expect(JSON.stringify(runtime.servers)).not.toContain('REMOTE_AUTH')
  })

  it.each([
    undefined, '', 'file:///private/mcp', 'ftp://mcp.example/api', 'https://user:secret@mcp.example/api',
    'https://mcp.example/api?token=secret', 'https://mcp.example/api#fragment', 'https://mcp.example/api?',
    'https://mcp.example/api#', 'https://mcp.example/\0api', ' https://mcp.example/api', 'https://mcp.example/\napi',
  ])('rejects an HTTP MCP endpoint with unsafe or invalid URL %s', url => {
    const projection = projectMcpForClaude([mcpServer({ serverName: 'remote', transport: 'streamable-http', ...(url === undefined ? {} : { url }) })])
    expect(projection.servers).toEqual([])
    expect(projection.skipped).toEqual([{ serverName: 'remote', reason: 'invalid-launch' }])
  })

  it('skips disabled and managed HTTP services without resolving their credentials', async () => {
    const projection = projectMcpForClaude([
      mcpServer({ serverName: 'disabled-http', transport: 'streamable-http', url: 'https://mcp.example', enabled: false, headerRefs: { Authorization: 'AUTH' } }),
      mcpServer({ serverName: 'zerowall_managed_remote', transport: 'streamable-http', url: 'https://mcp.example' }),
      mcpServer({ serverName: 'managed-command', transport: 'streamable-http', url: 'https://mcp.example', command: 'zerowall-managed:remote' }),
    ])
    const resolve = vi.fn()
    const runtime = await prepareClaudeMcpRuntime(projection, resolve)
    expect(runtime.servers).toEqual([])
    expect(runtime.skipped.map(item => item.reason)).toEqual(['disabled', 'managed-server', 'managed-server'])
    expect(resolve).not.toHaveBeenCalled()
  })

  it.each([
    { Authorization: 'literal secret' },
    { Authorization: 'vault://secret' },
    { 'Authorization\r\nX-Injected': 'AUTH' },
    { Authorization: 'AUTH', authorization: 'OTHER_AUTH' },
  ])('rejects invalid HTTP header names or credential references %j', headerRefs => {
    const projection = projectMcpForClaude([mcpServer({ serverName: 'remote', transport: 'streamable-http', url: 'https://mcp.example', headerRefs })])
    expect(projection.servers).toEqual([])
    expect(projection.skipped).toEqual([{ serverName: 'remote', reason: 'invalid-credential-reference' }])
  })

  it.each([undefined, '', '   ', 'bad\0value', 'Bearer token\r\nX-Injected: true'])('omits HTTP services with unavailable or unsafe credential values (%s)', async value => {
    const projection = projectMcpForClaude([mcpServer({ serverName: 'remote', transport: 'streamable-http', url: 'https://mcp.example', headerRefs: { 'X-First': 'FIRST_AUTH', Authorization: 'MISSING_AUTH' } })])
    const resolve = vi.fn(async name => name === 'FIRST_AUTH' ? 'first-private-value' : value)
    const runtime = await prepareClaudeMcpRuntime(projection, resolve)
    expect(runtime.servers).toEqual([])
    expect(runtime.environment).toEqual({})
    expect(runtime.skipped).toEqual([{ serverName: 'remote', reason: 'credential-unavailable' }])
    expect(JSON.stringify(runtime)).not.toContain('first-private-value')
  })

  it('omits a service when the credential resolver throws without disclosing the error or partial secrets', async () => {
    const projection = projectMcpForClaude([mcpServer({ envRefs: { API_TOKEN: 'MCP_TOKEN' } })])
    const runtime = await prepareClaudeMcpRuntime(projection, async () => { throw new Error('private resolver details') })
    expect(runtime).toEqual({ servers: [], environment: {}, skipped: [{ serverName: 'local-tools', reason: 'credential-unavailable' }] })
  })

  it('isolates identical target names with different credentials across HTTP and stdio services', async () => {
    const projection = projectMcpForClaude([
      mcpServer({ serverName: 'remote-a', transport: 'streamable-http', url: 'https://a.example/mcp', headerRefs: { Authorization: 'AUTH_A' } }),
      mcpServer({ serverName: 'remote-b', transport: 'streamable-http', url: 'https://b.example/mcp', headerRefs: { Authorization: 'AUTH_B' } }),
      mcpServer({ serverName: 'local-a', envRefs: { API_TOKEN: 'TOKEN_A' } }),
      mcpServer({ serverName: 'local-b', envRefs: { API_TOKEN: 'TOKEN_B' } }),
    ])
    const secrets: Record<string, string> = { AUTH_A: 'Bearer key-a', AUTH_B: 'Bearer key-b', TOKEN_A: 'local-secret-a', TOKEN_B: 'local-secret-b' }
    const runtime = await prepareClaudeMcpRuntime(projection, async name => secrets[name])
    expect(runtime.servers).toHaveLength(4)
    expect(Object.keys(runtime.environment)).toHaveLength(4)
    for (const server of runtime.servers) {
      const placeholder = Object.values(server.type === 'http' ? server.headers ?? {} : server.env ?? {})[0]!
      expect(placeholder).toMatch(/^\$\{ZW_CLAUDE_MCP_[0-9A-F]{20}\}$/u)
      const variable = placeholder.slice(2, -1)
      const ref = server.serverName === 'remote-a' ? 'AUTH_A' : server.serverName === 'remote-b' ? 'AUTH_B' : server.serverName === 'local-a' ? 'TOKEN_A' : 'TOKEN_B'
      expect(runtime.environment[variable]).toBe(secrets[ref])
    }
    for (const secret of Object.values(secrets)) expect(JSON.stringify(runtime.servers)).not.toContain(secret)
  })
})
