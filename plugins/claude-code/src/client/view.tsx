import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '../../lib/typert.remote-client.js'
import type { RemoteResult, TypertRemoteNamespace } from '@deepseek-ai/dsh-typert-protocol'
import { NS } from '@zerowallscience/plugin-base/client-helpers'
import { ClaudeCodeAction, type ClaudeCodeActionInjected } from './ClaudeCodeAction.js'

export const inject = ['slots', 'remote.zerowallClaudeCode']

type ClaudeCodeRemote = TypertRemoteNamespace<'zerowallClaudeCode'>

export function bindClaudeCodeRemote(remote: ClaudeCodeRemote, sessionId: SessionId): ClaudeCodeActionInjected {
  const value = async <T,>(operation: Promise<RemoteResult<T>>): Promise<T> => {
    const result = await operation
    if (!result.ok) throw new Error(result.error.message)
    return result.value
  }
  return {
    getStatus: () => value(remote.status(sessionId)),
    start: prompt => value(remote.start(sessionId, prompt)),
    read: () => value(remote.read(sessionId)),
    stop: () => value(remote.stop(sessionId)),
    install: () => value(remote.install(sessionId)),
    rollback: () => value(remote.rollback(sessionId)),
    uninstall: () => value(remote.uninstall(sessionId)),
    clear: () => value(remote.clear(sessionId)),
  }
}

export function apply(ctx: ClientContext): void {
  const remote = ctx.get('remote.zerowallClaudeCode') as ClaudeCodeRemote
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'zerowall-claude-code-run',
    order: 40,
    locale: NS,
    inject: (sessionId: SessionId) => bindClaudeCodeRemote(remote, sessionId),
  }, ClaudeCodeAction))
}
