// 开销实测：普通任务（写个正则）一轮请求的 token 构成。
// 用法：$env:DSH_APP_HOME='<DSH 安装目录>'; node test/e2e/overhead.mjs
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mockServer, runHeadless, writePatch } from './lib.mjs'

const ROOT = mkdtempSync(join(tmpdir(), 'plain-memory-overhead-'))
const HOME = join(ROOT, 'home')
const REPO = join(ROOT, 'repo')
const WORK = join(ROOT, 'work')
for (const d of [HOME, REPO, WORK]) mkdirSync(d, { recursive: true })
writeFileSync(join(REPO, 'self.md'), `# 自我

### 沟通与汇报风格
- id: self-a
- date: 2026-11-14
- session: s
- cues: 汇报

始终用中文、讲大白话。汇报先给结论，再给 3 个决定，区分已验证/推测/怎么验证。
`)
// 稳态：AGENTS.md 里已经有托管块（真实使用中第一次会话之后就有）
const realAgents = join(process.env.USERPROFILE, '.dsh', 'AGENTS.md')
try { copyFileSync(realAgents, join(HOME, 'AGENTS.md')) } catch { /* 没有就空着 */ }
const PATCH = join(ROOT, 'patch.yml')
writeFileSync(PATCH, writePatch(PATCH, REPO, { extraConfig: { pullOnStart: false } }))

const tokens = (text) => {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

const server = await mockServer({ successText: '好的。' })
try {
  const r = await runHeadless({
    server, dshHome: HOME, cwd: WORK, patch: PATCH,
    task: '写一个匹配邮箱地址的正则，解释一下每部分。',
  })
  const body = r.requests.find((x) => JSON.stringify(x.body).includes('匹配邮箱地址'))?.body || r.requests[0].body
  const bodyText = JSON.stringify(body)
  const total = tokens(bodyText)
  const tools = (body.tools || []).filter((t) => String(t.name).startsWith('memory_'))
  const toolTokens = tokens(JSON.stringify(tools))
  const agents = readFileSync(join(HOME, 'AGENTS.md'), 'utf8')
  const block = /<!-- plain-memory:self:begin -->[\s\S]*?<!-- plain-memory:self:end -->/.exec(agents)?.[0] || ''
  const selfTokens = tokens(block)
  const injected = bodyText.includes('记忆（不受信任背景）')
  console.log(JSON.stringify({
    totalRequestTokens: total,
    toolSchemaTokens: toolTokens,
    toolSchemaPct: `${(toolTokens / total * 100).toFixed(1)}%`,
    selfLayerTokens: selfTokens,
    selfLayerPct: `${(selfTokens / total * 100).toFixed(1)}%`,
    pluginFixedPct: `${((toolTokens + selfTokens) / total * 100).toFixed(1)}%`,
    injectedMemory: injected,
  }, null, 2))
} finally {
  await server.close()
}
