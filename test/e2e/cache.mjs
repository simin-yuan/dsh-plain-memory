// 提示缓存：同一会话连续 3 轮，注入之前的消息前缀必须逐字节不变。
// 用法：$env:DSH_APP_HOME='<DSH 安装目录>'; node test/e2e/cache.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { mockServer, runHeadless, writePatch } from './lib.mjs'

const ROOT = mkdtempSync(join(tmpdir(), 'plain-memory-cache-'))
const HOME = join(ROOT, 'home')
const REPO = join(ROOT, 'repo')
const WORK = join(ROOT, 'work')
for (const d of [HOME, REPO, WORK]) mkdirSync(d, { recursive: true })
execFileSync('git', ['init', '-q', REPO])
mkdirSync(join(REPO, 'semantic'), { recursive: true })
writeFileSync(join(REPO, 'self.md'), '# 自我\n')
writeFileSync(join(REPO, 'semantic', 'cache.md'), `### 注入只追加不改前缀
- id: sem-cache
- date: 2026-11-13
- session: seed
- cues: 注入, 缓存, 前缀

pre-step 只追加 user message，不改历史前缀。
`)

const PATCH = join(ROOT, 'patch.yml')
writeFileSync(PATCH, writePatch(PATCH, REPO))

const newestSession = () => {
  const base = join(HOME, 'sessions')
  const dirs = []
  const walk = (dir, depth) => {
    if (depth > 3) return
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      if (!statSync(full).isDirectory()) continue
      if (name.startsWith('session-')) dirs.push({ full, name, mtime: statSync(full).mtimeMs })
      else walk(full, depth + 1)
    }
  }
  walk(base, 0)
  return dirs.sort((a, b) => b.mtime - a.mtime)[0]?.name
}

const pickTurn = (requests, task) => requests
  .filter((r) => JSON.stringify(r.body).includes(task))
  .sort((a, b) => (b.body.messages?.length || 0) - (a.body.messages?.length || 0))[0]

const server = await mockServer({ successText: '收到。' })
try {
  const marks = []
  const turns = []
  for (let i = 1; i <= 3; i += 1) {
    const start = server.requests.length
    const sessionId = i === 1 ? undefined : turns[0].sessionId
    const task = `第 ${i} 轮：注入会不会破坏缓存？`
    const r = await runHeadless({
      server, dshHome: HOME, cwd: WORK, patch: PATCH, task,
      extraArgs: sessionId ? ['--session-id', sessionId] : [],
    })
    assert.equal(r.code, 0, `第 ${i} 轮退出码 ${r.code}\n${r.stderr.slice(-3000)}`)
    const slice = server.requests.slice(start)
    const turn = pickTurn(slice, task)
    assert.ok(turn, `第 ${i} 轮没找到请求`)
    turns.push({ sessionId: i === 1 ? newestSession() : sessionId, messages: turn.body.messages })
    marks.push(`${i}:${turn.body.messages.length}`)
    if (i === 1 && !turns[0].sessionId) throw new Error('找不到会话 id')
  }

  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
  const m2 = turns[1].messages
  const m3 = turns[2].messages
  assert.ok(m2.length < m3.length, `第三轮消息数没有增长：${m2.length}/${m3.length}`)
  const prefix = m3.slice(0, m2.length)
  assert.ok(same(prefix, m2), '第三轮把第二轮之前的历史改动了')

  // 本轮注入必须只出现在末尾：第二轮的最后一条是注入，第三轮的最后一条也是注入
  assert.ok(JSON.stringify(m2[m2.length - 1]).includes('记忆（不受信任背景）'), '第二轮末尾没有注入')
  assert.ok(JSON.stringify(m3[m3.length - 1]).includes('记忆（不受信任背景）'), '第三轮末尾没有注入')
  // 历史里的注入原样保留，位置不变（前缀比对已覆盖），这里再确认条数只增不改
  assert.equal(m3.length, m2.length + 2, `消息数应每次增加 2 条，实际 ${m2.length} → ${m3.length}`)

  console.log(`消息数 ${marks.join(' → ')}`)
  for (const [i, m] of turns.entries()) {
    console.log(`第 ${i + 1} 轮：`, m.messages.map((x) => `${x.role}${JSON.stringify(x).includes('记忆（不受信任背景）') ? '+inj' : ''}`).join(' | '))
  }
  console.log(`前缀逐字节一致：${m2.length} 条（第二轮）⊂ 第三轮 ${m3.length} 条`)
  console.log('3 轮通过')
} catch (error) {
  console.error('CACHE TEST FAILED:', error.message)
  console.error(`临时目录保留：${ROOT}`)
  process.exitCode = 1
} finally {
  await server.close()
}
