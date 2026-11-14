// 硬指标实测：固定注入、召回注入、卸载恢复。
// 用法：$env:DSH_APP_HOME='<DSH 安装目录>'; node test/e2e/measure.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { mockServer, runHeadless, writePatch } from './lib.mjs'

const ROOT = mkdtempSync(join(tmpdir(), 'plain-memory-measure-'))
const HOME = join(ROOT, 'home')
const REPO = join(ROOT, 'repo')
const WORK = join(ROOT, 'work')
for (const d of [HOME, REPO, WORK]) mkdirSync(d, { recursive: true })
execFileSync('git', ['init', '-q', REPO])
execFileSync('git', ['-C', REPO, 'config', 'user.name', 'm'])
execFileSync('git', ['-C', REPO, 'config', 'user.email', 'm@example.invalid'])
writeFileSync(join(REPO, 'self.md'), '# 自我\n')
const PATCH = join(ROOT, 'patch.yml')
writeFileSync(PATCH, writePatch(PATCH, REPO, { extraConfig: { pullOnStart: false } }))

const servers = []
const withServer = async (opts) => { const s = await mockServer(opts); servers.push(s); return s }
const tokens = (s) => {
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  return Math.ceil(cjk + (s.length - cjk) / 4)
}
const blockOf = (body) => {
  for (const m of body.messages || []) {
    const text = (m?.content || []).map((b) => b?.text || '').join('')
    const at = text.indexOf('## 记忆（不受信任背景）')
    if (at !== -1) return text.slice(at)
  }
  return ''
}

const out = {}
try {
  const empty = await runHeadless({ server: await withServer({ successText: '好。' }), dshHome: HOME, cwd: WORK, patch: PATCH, task: '你好' })
  assert.equal(empty.code, 0, empty.stderr.slice(-2000))
  const body = empty.requests[0].body
  const mine = (body.tools || []).filter((t) => String(t.name).startsWith('memory_'))
  out.toolSchemas = mine.length
  out.fixedToolsChars = JSON.stringify(mine).length
  out.fixedToolsTokens = tokens(JSON.stringify(mine))
  out.emptyInjection = blockOf(body) === ''
  assert.equal(out.emptyInjection, true, '空记忆时不应注入')

  mkdirSync(join(REPO, 'semantic'), { recursive: true })
  writeFileSync(join(REPO, 'semantic', 'cache.md'), `### 注入只追加不改前缀
- id: sem-m1
- date: 2026-11-13
- session: 2026-11-13T10:00:00Z/seed0001
- cues: 注入, 缓存, pre-step

pre-step 只追加 user message，提示缓存不失效。这条写得长一点，用来观察注入体量。
`)
  const hit = await runHeadless({ server: await withServer({ successText: '好。' }), dshHome: HOME, cwd: WORK, patch: PATCH, task: '注入会不会破坏缓存？' })
  assert.equal(hit.code, 0, hit.stderr.slice(-2000))
  const block = blockOf(hit.requests[0].body)
  out.recallBlockChars = block.length
  out.recallBlockTokens = tokens(block)
  assert.ok(out.recallBlockTokens <= 1000)

  const before = readdirSync(REPO).sort().join(',')
  const plain = await runHeadless({ server: await withServer({ successText: '好。' }), dshHome: HOME, cwd: WORK, patch: null, task: '你好' })
  assert.equal(plain.code, 0, plain.stderr.slice(-2000))
  out.uninstallOk = readdirSync(REPO).sort().join(',') === before

  console.log(JSON.stringify(out, null, 2))
} catch (error) {
  console.error('MEASURE FAILED:', error.message)
  console.error(`临时目录保留：${ROOT}`)
  process.exitCode = 1
} finally {
  await Promise.all(servers.map((s) => s.close()))
}
