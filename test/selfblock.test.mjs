// 自我层同步自测：把 self.md 渲染成 AGENTS.md 托管块，且不碰用户自己的内容。
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { renderSelfBlock, removeSelfBlock, syncSelfBlock } from '../index.js'

const home = mkdtempSync(join(tmpdir(), 'plain-memory-self-'))
const repo = join(home, 'repo')
mkdirSync(join(repo, 'semantic'), { recursive: true })
writeFileSync(join(repo, 'self.md'), `# 自我

### 交流用中文
- id: self-1
- date: 2026-11-13
- session: s1
- cues: 中文

始终用中文交流。

### 先结论
- id: self-2
- date: 2026-11-13
- session: s1
- cues: 汇报

汇报先给结论。
`)
writeFileSync(join(home, 'AGENTS.md'), '# 我自己的规则\n\n不要动这一段。\n')

const saved = process.env.DSH_HOME
process.env.DSH_HOME = home
try {
  const block = renderSelfBlock(repo)
  assert.match(block, /plain-memory:self:begin/)
  assert.match(block, /始终用中文交流/)
  assert.match(block, /汇报先给结论/)
  assert.ok(!block.includes('不要动这一段'), '托管块不该包含用户自己的内容')

  syncSelfBlock(repo)
  const first = readFileSync(join(home, 'AGENTS.md'), 'utf8')
  assert.match(first, /我自己的规则/)
  assert.match(first, /不要动这一段/)
  assert.match(first, /始终用中文交流/)
  assert.equal(first.split('plain-memory:self:begin').length - 1, 1, '托管块重复了')

  syncSelfBlock(repo)
  const second = readFileSync(join(home, 'AGENTS.md'), 'utf8')
  assert.equal(second, first, '二次同步改动了内容')

  // self.md 变空 → 托管块被移除，用户内容保留
  writeFileSync(join(repo, 'self.md'), '# 自我\n')
  syncSelfBlock(repo)
  const third = readFileSync(join(home, 'AGENTS.md'), 'utf8')
  assert.ok(!third.includes('plain-memory:self:begin'), '空自我层没有清掉托管块')
  assert.match(third, /我自己的规则/)

  // 卸载清理：托管块消失，用户自己的内容一字不少
  syncSelfBlock(repo)
  removeSelfBlock()
  const afterUninstall = readFileSync(join(home, 'AGENTS.md'), 'utf8')
  assert.ok(!afterUninstall.includes('plain-memory:self:begin'), '卸载后托管块还在')
  assert.match(afterUninstall, /我自己的规则/)

  console.log(`托管块 ${block.length} 字符；用户内容保留；重复同步幂等；清空后自动移除；卸载清理通过`)
  console.log('自我层同步测试通过')
} finally {
  if (saved === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = saved
  rmSync(home, { recursive: true, force: true, maxRetries: 5 })
}
