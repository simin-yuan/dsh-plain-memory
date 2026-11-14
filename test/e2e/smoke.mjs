// 冒烟：两个进程（两个「窗口」）对真实记忆仓，验证卡片互见、写入落盘、提交进历史。
// 用法：$env:DSH_APP_HOME='<DSH 安装目录>'; $env:MEMORY_REPO='<记忆仓路径>'; node test/e2e/smoke.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { mockServer, runHeadless, writePatch } from './lib.mjs'

const REPO = process.env.MEMORY_REPO
if (!REPO) throw new Error('设置 MEMORY_REPO 指向真实记忆仓')
const ROOT = mkdtempSync(join(tmpdir(), 'plain-memory-smoke-'))
const HOME = join(ROOT, 'home')
const WORK = join(ROOT, 'work')
mkdirSync(HOME, { recursive: true })
mkdirSync(WORK, { recursive: true })
// 窗口之间靠「同一条工作线（git 分支）」关联，所以工作目录得是个仓库
execFileSync('git', ['init', '-q', WORK])
const PATCH = join(ROOT, 'patch.yml')
writeFileSync(PATCH, writePatch(PATCH, REPO))

const servers = []
const withServer = async (opts) => { const s = await mockServer(opts); servers.push(s); return s }
const before = execFileSync('git', ['-C', REPO, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()

try {
  const a = await runHeadless({
    server: await withServer({
      sequence: ['tool_call_success', 'success'],
      toolName: 'memory_card',
      toolArguments: JSON.stringify({ objective: '把原味记忆装上桌面', conclusion: '四项验证全部通过' }),
      successText: '卡片已更新。',
    }),
    dshHome: HOME, cwd: WORK, patch: PATCH, task: '窗口一：把原味记忆装上桌面。',
  })
  assert.equal(a.code, 0, a.stderr.slice(-2000))

  const b = await runHeadless({
    server: await withServer({
      sequence: ['tool_call_success', 'success'],
      toolName: 'memory_write',
      toolArguments: JSON.stringify({
        layer: 'semantic', title: '原味记忆的四项验证',
        body: '提示缓存：连续 3 轮前缀逐字节一致；跨领域：5/5 命中且无关提问 0 误召回；git 不挡回合；两进程并发 20/20 落盘。',
        cues: '记忆, 注入, 缓存, 跨领域, 并发',
      }),
      successText: '记住了。',
    }),
    dshHome: HOME, cwd: WORK, patch: PATCH, task: '窗口二：另一个窗口在做什么？顺便记住这次验证。',
  })
  assert.equal(b.code, 0, b.stderr.slice(-2000))

  const req = JSON.stringify(b.requests[0].body)
  assert.match(req, /\[窗口\]/, '窗口二没有看到窗口一的状态卡')
  assert.match(req, /把原味记忆装上桌面/, '窗口二看到的卡片缺目标')

  const cards = readdirSync(join(REPO, '.state', 'cards')).filter((n) => n.endsWith('.json'))
  assert.ok(cards.length >= 2, `状态卡少于 2 张：${cards.length}`)

  const written = readdirSync(join(REPO, 'semantic')).filter((n) => n.includes('原味记忆的四项验证'))
  assert.ok(written.length === 1, `记忆文件数量异常：${written.length}`)

  await new Promise((r) => setTimeout(r, 500))
  const after = execFileSync('git', ['-C', REPO, 'rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()
  const status = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim()
  assert.ok(Number(after) > Number(before), '没有产生新提交')
  assert.equal(status, '', `工作区不干净：${status}`)

  // 推送在后台跑，不挡回合：给最多 30 秒追平
  const rev = (ref) => execFileSync('git', ['-C', REPO, 'rev-parse', ref], { encoding: 'utf8' }).trim()
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline && rev('origin/main') !== rev('HEAD')) {
    await new Promise((r) => setTimeout(r, 500))
  }
  const remote = rev('origin/main')
  const head = rev('HEAD')
  assert.equal(remote, head, '本地提交在 30 秒内没有推到远端')

  console.log(`状态卡 ${cards.length} 张；提交 ${before} → ${after}；远端已同步：${remote.slice(0, 8)}`)
  console.log('冒烟通过：两个窗口互见、记忆落盘、提交已推送')
} catch (error) {
  console.error('SMOKE FAILED:', error.message)
  console.error(`临时目录保留：${ROOT}`)
  process.exitCode = 1
} finally {
  await Promise.all(servers.map((s) => s.close()))
}
