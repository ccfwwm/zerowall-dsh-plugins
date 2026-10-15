import test from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { sourceFiles, isExportableSource } from './source-files.mjs'

test('current source includes untracked files and excludes ignored secrets and legacy roots', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zws-source-test-'))
  try {
    execFileSync('git', ['init', '-q', root])
    await mkdir(join(root, 'plugins/new/src'), { recursive: true })
    await writeFile(join(root, 'plugins/new/src/current.ts'), 'export const current = true')
    await writeFile(join(root, '.gitignore'), '*.secret\n')
    await writeFile(join(root, 'plugins/new/token.secret'), 'test fixture')
    assert.deepEqual(sourceFiles(root), ['plugins/new/src/current.ts'])
    for (const path of ['plugins/new/.env', 'plugins/new/private.key', 'plugins/new/lib/x.js', 'plugins/new/user-data/a.json', 'packages/store/src/index.ts']) assert.equal(isExportableSource(path), false)
    assert.equal(isExportableSource('plugins/mcp/src/scimaster/zerowall-mcp-launcher.cjs'), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
