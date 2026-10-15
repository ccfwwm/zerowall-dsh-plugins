import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { integrationPublishSource, usesReviewedRuntime } from './publish-source.mjs'

test('only established runtime-only adapters use the reviewed projection', () => {
  const roots = { root: '/repo', stageRoot: '/stage' }
  for (const name of ['@changfenhuang/dsh-genui', '@dingyi222666/dsh-session-notification']) {
    const integration = { package: name, source: 'plugins/example' }
    assert.equal(usesReviewedRuntime(integration), true)
    assert.equal(integrationPublishSource(integration, roots), join('/stage', 'offline-profile/modules', name))
  }
  for (const name of ['dsh-better-sidebar', '@michengai/dsh-archive-manager', '@oh-story/dsh', '@zerowallscience/plugin-base']) {
    const integration = { package: name, source: 'plugins/example', catalogOptional: true }
    assert.equal(usesReviewedRuntime(integration), false)
    assert.equal(integrationPublishSource(integration, roots), join('/repo', 'plugins/example'))
  }
  assert.equal(integrationPublishSource({ source: 'resources/skills' }, roots), undefined)
})
