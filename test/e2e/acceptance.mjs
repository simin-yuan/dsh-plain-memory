// 验收：① 新会话第一轮请求体里带 self.md；② memory_write 立即由插件提交。
// 用法：$env:DSH_APP_HOME='<DSH 安装目录>'; node test/e2e/acceptance.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { mockServer, runHeadless, writePatch } from './lib.mjs'

const ROOT = mkdtempSync(join(tmpdir(), 'plain-memory-accept-'))
const HOME = join(ROOT, 'home')
const REPO = join(ROOT, 'repo')
const WORK = join(ROOT, 'work')
for (const d of [HOME, REPO, WORK]) mkdirSync(d, { recursive: true })
execFileSync('git', ['init', '-q', REPO])
execFileSync('git', ['-C', REPO, 'config', 'user.name', 'a'])
execFileSync('git', ['-C', REPO, 'config', 'user.email', 'a@example.invalid'])
mkdirSync(join(REPO, 'semantic'), { recursive: true })
writeFileSync(join(REPO, 'self.md'), `# 自我

### 交流用中文
- id: self-accept
- date: 2026-11-13
- session: seed
- cues: 中文, 大白话

始终用中文交流，用大白话讲进展。
`)
writeFileSync(join(HOME, 'AGENTS.md'), '# 用户自己的规则\n\nMAGIC-USER-RULE-7f3a 这一段必须保留。\n')
const PATCH = join(ROOT, 'patch.yml')
writeFileSync(PATCH, writePatch(PATCH, REPO, { extraConfig: { pullOnStart: false } }))

const servers = []
const withServer = async (opts) => { const s = await mockServer(opts); servers.push(s); return s }

try {
  const r1 = await runHeadless({
    server: await withServer({ successText: '好。' }),
    dshHome: HOME, cwd: WORK, patch: PATCH, task: '早上好。',
  })
  assert.equal(r1.code, 0, r1.stderr.slice(-2000))
  const body1 = JSON.stringify(r1.requests[0].body)
  assert.match(body1, /MAGIC-USER-RULE-7f3a/, '用户自己的 AGENTS.md 内容没进请求')
  assert.match(body1, /始终用中文交流/, 'self.md 没有进第一轮请求')

  const r2 = await runHeadless({
    server: await withServer({ successText: '好。' }),
    dshHome: HOME, cwd: WORK, patch: PATCH, task: '又一个新会话。',
  })
  assert.equal(r2.code, 0, r2.stderr.slice(-2000))
  assert.match(JSON.stringify(r2.requests[0].body), /始终用中文交流/, '第二个新会话丢了自我层')

  const r3 = await runHeadless({
    server: await withServer({
      sequence: ['tool_call_success', 'success'],
      toolName: 'memory_write',
      toolArguments: JSON.stringify({ layer: 'semantic', title: '自动提交验收', body: '这条必须在回合结束前就被插件提交。', cues: '提交, 自测' }),
      successText: '记住了。',
    }),
    dshHome: HOME, cwd: WORK, patch: PATCH, task: '记住：这条用来验收自动提交。',
  })
  assert.equal(r3.code, 0, r3.stderr.slice(-2000))
  const log = execFileSync('git', ['-C', REPO, 'log', '--format=%s'], { encoding: 'utf8' })
  assert.match(log, /memory: 自动提交验收/, `没有自动提交，log=${log}`)
  const status = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  assert.equal(status, '', `工作区不干净：${status}`)

  console.log('自我层进了第一轮请求，且两个新会话都在')
  console.log('memory_write 立即提交：log 里出现「memory: 自动提交验收」')
  console.log('验收通过')
} catch (error) {
  console.error('ACCEPTANCE FAILED:', error.message)
  console.error(`临时目录保留：${ROOT}`)
  process.exitCode = 1
} finally {
  await Promise.all(servers.map((s) => s.close()))
}
