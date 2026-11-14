// 端到端：真 DSH headless + 真 agent loop + 假模型服务器。
// 用法：$env:DSH_APP_HOME='<DSH 安装目录>'; node test/e2e/run.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { mockServer, runHeadless, writePatch } from './lib.mjs'

const ROOT = mkdtempSync(join(tmpdir(), 'plain-memory-e2e-'))
const HOME = join(ROOT, 'home')
const REPO = join(ROOT, 'repo')
const WORK = join(ROOT, 'work')
for (const d of [HOME, REPO, WORK]) mkdirSync(d, { recursive: true })
execFileSync('git', ['init', '-q', WORK])
const BRANCH = execFileSync('git', ['-C', WORK, 'symbolic-ref', '--short', 'HEAD'], { encoding: 'utf8' }).trim()
// 临时目录可能落在 8.3 短路径下；DSH 报的 cwd 是长路径，建完目录再归一
const WORK_REAL = (() => { try { return realpathSync.native(WORK) } catch { return WORK } })()
execFileSync('git', ['init', '-q', REPO])
execFileSync('git', ['-C', REPO, 'config', 'user.name', 'e2e'])
execFileSync('git', ['-C', REPO, 'config', 'user.email', 'e2e@example.invalid'])
mkdirSync(join(REPO, 'semantic'), { recursive: true })
writeFileSync(join(REPO, 'self.md'), '# 自我\n')
writeFileSync(join(REPO, 'semantic', 'cache.md'), `### 注入只追加不改前缀
- id: sem-e2e
- date: 2026-11-13
- session: 2026-11-13T10:00:00Z/seed0001
- cues: 注入, 缓存, pre-step

pre-step 只追加 user message，提示缓存不失效。
`)
const PATCH = join(ROOT, 'patch.yml')
writeFileSync(PATCH, writePatch(PATCH, REPO, { extraConfig: { cards: true } }))

const servers = []
const withServer = async (opts) => { const s = await mockServer(opts); servers.push(s); return s }
const tokens = (s) => {
  const cjk = (s.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  return Math.ceil(cjk + (s.length - cjk) / 4)
}

const results = []
try {
  const r1 = await runHeadless({
    server: await withServer({ successText: '不会，只追加。' }),
    dshHome: HOME, cwd: WORK, patch: PATCH, task: '注入会破坏缓存吗？用一句话回答。',
  })
  assert.equal(r1.code, 0, `run1 exit ${r1.code}\n${r1.stderr.slice(-3000)}`)
  const body1 = JSON.stringify(r1.requests[0].body)
  assert.match(body1, /plain-memory/, 'run1 请求里没有注入块')
  assert.match(body1, /注入只追加不改前缀/, 'run1 没有召回预置记忆')
  results.push('真 DSH 请求里出现了召回块')

  const cardsDir = join(REPO, '.state', 'cards')
  mkdirSync(cardsDir, { recursive: true })
  writeFileSync(join(cardsDir, 'peer.json'), JSON.stringify({
    v: 1, session: 'peer-window-0001', cwd: WORK_REAL, line: BRANCH,
    files: [], objective: '把记忆插件收尾', conclusion: '采用 pre-step 追加', updatedAt: Date.now(),
  }))
  const r2 = await runHeadless({
    server: await withServer({ successText: '它在收尾。' }),
    dshHome: HOME, cwd: WORK, patch: PATCH, task: '记忆插件收尾到哪一步了？',
  })
  assert.equal(r2.code, 0, `run2 exit ${r2.code}\n${r2.stderr.slice(-3000)}`)
  const body2 = JSON.stringify(r2.requests[0].body)
  assert.match(body2, /\[窗口\]/, 'run2 没有注入窗口增量')
  assert.match(body2, /把记忆插件收尾/, 'run2 窗口增量缺目标')
  results.push('第二个进程读到另一窗口的状态卡增量')

  const r3 = await runHeadless({
    server: await withServer({
      sequence: ['tool_call_success', 'success'],
      toolName: 'memory_write',
      toolArguments: JSON.stringify({ layer: 'semantic', title: '端到端写入', body: 'headless 真跑通了一次 memory_write。', cues: '端到端, headless' }),
      successText: '记住了。',
    }),
    dshHome: HOME, cwd: WORK, patch: PATCH, task: '记住：端到端跑通了。',
  })
  assert.equal(r3.code, 0, `run3 exit ${r3.code}\n${r3.stderr.slice(-3000)}`)
  const written = readdirSync(join(REPO, 'semantic')).find((f) => f.includes('端到端写入'))
  assert.ok(written, '没有写出记忆文件')
  assert.match(readFileSync(join(REPO, 'semantic', written), 'utf8'), /headless 真跑通了一次 memory_write/)
  const log = execFileSync('git', ['-C', REPO, 'log', '--oneline'], { encoding: 'utf8' })
  assert.match(log, /memory: 端到端写入/)
  results.push('真工具调用写进 Markdown，并由插件当场提交')

  const block = (() => {
    for (const m of r1.requests[0].body.messages || []) {
      const text = (m?.content || []).map((b) => b?.text || '').join('')
      const at = text.indexOf('## 记忆（不受信任背景）')
      if (at !== -1) return text.slice(at)
    }
    return ''
  })()
  results.push(`单条召回注入 ${block.length} 字符 ≈ ${tokens(block)} token`)

  console.log(results.map((r) => `ok ${r}`).join('\n'))
  console.log(`\n${results.length} 项端到端通过`)
} catch (error) {
  console.error('E2E FAILED:', error.message)
  console.error(`临时目录保留：${ROOT}`)
  process.exitCode = 1
} finally {
  await Promise.all(servers.map((s) => s.close()))
}
