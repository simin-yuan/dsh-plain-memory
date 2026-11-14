// 并发写入：两个进程同时各写 10 条，一条都不能丢、一个错都不能有。
// 用法：node test/e2e/concurrency.mjs
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { fileURLToPath } from 'node:url'
import { readRepo } from '../../memory.js'
import { commit } from '../../git.js'

const ROOT = mkdtempSync(join(tmpdir(), 'plain-memory-conc-'))
const REPO = join(ROOT, 'repo')
mkdirSync(REPO, { recursive: true })
execFileSync('git', ['init', '-q', REPO])
execFileSync('git', ['-C', REPO, 'config', 'user.name', 'conc'])
execFileSync('git', ['-C', REPO, 'config', 'user.email', 'conc@example.invalid'])

const worker = fileURLToPath(new URL('./worker-write.mjs', import.meta.url))
const run = (prefix) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [worker, REPO, prefix, '10'], { stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout.on('data', (d) => { out += d })
  child.stderr.on('data', (d) => { err += d })
  child.on('error', reject)
  child.on('exit', (code) => resolve({ code, out, err }))
})

const [a, b] = await Promise.all([run('甲'), run('乙')])
const fail = [a, b].filter((r) => r.code !== 0)
assert.equal(fail.length, 0, `子进程失败：${fail.map((f) => f.err).join('\n')}`)
for (const r of [a, b]) assert.equal(r.err.trim(), '', `子进程 stderr 非空：${r.err}`)

const entries = readRepo(REPO)
const titles = new Set(entries.map((e) => e.title))
for (let i = 0; i < 10; i += 1) {
  assert.ok(titles.has(`甲-${i}`), `丢了 甲-${i}`)
  assert.ok(titles.has(`乙-${i}`), `丢了 乙-${i}`)
}
assert.equal(entries.length, 20, `应有 20 条，实际 ${entries.length}`)

const log = execFileSync('git', ['-C', REPO, 'log', '--oneline'], { encoding: 'utf8' }).trim().split('\n')
const dirtyBefore = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim()

// 模拟「下次会话」：把可能留在工作区的改动补交上去
const cleanup = await commit(REPO, 'memory(resume): 补交并发遗留')
const dirtyAfter = execFileSync('git', ['-C', REPO, 'status', '--porcelain'], { encoding: 'utf8' }).trim()

console.log(`20 条全部落盘：是（${entries.length}）`)
console.log(`提交数：${log.length}；并发后工作区：${dirtyBefore ? '有未提交改动（按设计留到下次）' : '干净'}`)
console.log(`补交后工作区：${dirtyAfter ? '仍有改动（异常）' : '干净'}；补交结果：${cleanup.ok ? 'ok' : cleanup.detail}`)
assert.equal(dirtyAfter, '', '补交后工作区仍不干净')
console.log('并发测试通过')
