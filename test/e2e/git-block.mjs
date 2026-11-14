// git 不得挡住回合：把远端指向不可达地址，push 会挂起；回合必须照常结束。
// 用法：$env:DSH_APP_HOME='<DSH 安装目录>'; node test/e2e/git-block.mjs
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { mockServer, runHeadless, writePatch } from './lib.mjs'

const ROOT = mkdtempSync(join(tmpdir(), 'plain-memory-gitblock-'))
const WORK = join(ROOT, 'work')
mkdirSync(WORK, { recursive: true })

function makeRepo(name, remote) {
  const repo = join(ROOT, name)
  mkdirSync(repo, { recursive: true })
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'gb'])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'gb@example.invalid'])
  if (remote) execFileSync('git', ['-C', repo, 'remote', 'add', 'origin', remote])
  const patch = join(ROOT, `${name}.yml`)
  // pullOnStart 关掉，只测 push 对回合的影响（pull 另有 5s 上限）
  writeFileSync(patch, writePatch(patch, repo, { extraConfig: { pullOnStart: false } }))
  return { repo, patch }
}

const clean = makeRepo('repo-clean', null)
// 192.0.2.0/24 是 TEST-NET-1，正常网络里不可达：连接会一直等到超时
const hung = makeRepo('repo-hung', 'git://192.0.2.1:9418/nope.git')

const writeArgs = JSON.stringify({ layer: 'semantic', title: '卡死测试', body: '远端不可达时回合也不能被 push 挡住。', cues: '卡住, 超时' })

async function one({ repo, patch }, label) {
  const server = await mockServer({
    sequence: ['tool_call_success', 'success'],
    toolName: 'memory_write',
    toolArguments: writeArgs,
    successText: '记住了。',
  })
  try {
    const r = await runHeadless({ server, dshHome: join(ROOT, 'home'), cwd: WORK, patch, task: `记住：${label}` })
    assert.equal(r.code, 0, `${label} 退出码 ${r.code}\n${r.stderr.slice(-2000)}`)
    const log = execFileSync('git', ['-C', repo, 'log', '--oneline'], { encoding: 'utf8' })
    assert.match(log, /memory\(turn\)/, `${label} 没有提交`)
    return r.ms
  } finally {
    await server.close()
  }
}

const base = await one(clean, '基线')
const blocked = await one(hung, '不可达远端')
const delta = blocked - base
console.log(`基线 ${base} ms；不可达远端 ${blocked} ms；差 ${delta} ms`)
assert.ok(delta < 5_000, `push 挡住了回合：多花 ${delta} ms`)
console.log('回合未被 push 阻塞：通过')
