// 插件装配自测：用假 ctx / 假 agent 驱动真实的 apply()，覆盖注入、卡片、工具、git。
// 用法：node test/plugin.test.mjs
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'

// 测试的 $DSH_HOME 必须隔离：插件会把自我层同步进 $DSH_HOME/AGENTS.md，
// 用真实 home 跑测试会覆盖用户自己的全局指令。
const testHome = mkdtempSync(join(tmpdir(), 'plain-memory-testhome-'))
process.env.DSH_HOME = testHome
mkdirSync(testHome, { recursive: true })
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from '../index.js'
import { readRepo } from '../memory.js'

const repo = mkdtempSync(join(tmpdir(), 'plain-memory-plugin-'))
const project = join(repo, 'project')
const results = []
const check = async (label, fn) => { await fn(); results.push(label); console.log(`ok ${label}`) }

function makeCtx() {
  const listeners = new Map()
  const tools = new Map()
  const ctx = {
    on(event, fn) { const list = listeners.get(event) || []; list.push(fn); listeners.set(event, list) },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    logger: { debug() {} },
    effect(fn) { return fn() },
  }
  return { ctx, listeners, tools }
}

const userMessage = (text) => ({ role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text }] })
const agent = (id, cwd) => ({ session: { id, header: { cwd } } })
const never = new AbortController().signal

async function preStep(listeners, who, text, step = 1) {
  const handler = listeners.get('agent/pre-step')[0]
  const decision = { kind: 'enter', messages: [userMessage(text)] }
  return handler({ agent: who, messages: decision.messages, turn: 1, step, signal: never }, async () => ({ kind: 'enter', messages: [userMessage(text)] }))
}

function injected(decision) {
  return decision.messages.filter((m) => m.source?.kind === 'plain-memory')
}

try {
  execFileSync('git', ['init', '-q', repo])
  execFileSync('git', ['-C', repo, 'config', 'user.name', 'test'])
  execFileSync('git', ['-C', repo, 'config', 'user.email', 'test@example.invalid'])
  execFileSync('git', ['-C', repo, 'commit', '-q', '--allow-empty', '-m', 'init'])
  // 两个窗口共用同一个工作目录（仓库内的 project），工作线 = 这个仓库的分支
  mkdirSync(project, { recursive: true })

  const { ctx, listeners, tools } = makeCtx()
  apply(ctx, { repoPath: repo, pullOnStart: false, pushOnTurnEnd: false, minScore: 0.5, cards: true })

  const A = agent('sess-AAAAAAAA', project)
  const B = agent('sess-BBBBBBBB', project)

  await check('工具注册了三个', () => {
    assert.deepEqual([...tools.keys()].sort(), ['memory_card', 'memory_confirm', 'memory_recall', 'memory_write'])
  })

  await check('写入语义记忆后，相关提问会注入', async () => {
    const out = await tools.get('memory_write').execute(
      { layer: 'semantic', title: 'DSH 注入点', body: 'pre-step 瀑布追加 user message，不动前缀，KV 缓存不失效。', cues: '注入,pre-step,缓存' },
      { agent: A },
    )
    assert.match(out, /已写入 semantic/)
    const decision = await preStep(listeners, A, '这个插件的注入是怎么实现的？')
    const msgs = injected(decision)
    assert.equal(msgs.length, 1)
    assert.match(msgs[0].content[0].text, /DSH 注入点/)
    assert.match(msgs[0].content[0].text, /不受信任背景/)
  })

  await check('无关消息零注入', async () => {
    const decision = await preStep(listeners, A, '今天天气不错，去跑步')
    assert.equal(injected(decision).length, 0)
  })

  await check('非首步不重复注入', async () => {
    const decision = await preStep(listeners, A, '这个插件的注入是怎么实现的？', 2)
    assert.equal(injected(decision).length, 0)
  })

  await check('另一窗口能看到状态卡目标', async () => {
    await tools.get('memory_card').execute({ objective: '把记忆插件收尾', conclusion: '注入走 pre-step' }, { agent: A })
    const decision = await preStep(listeners, B, '记忆插件收尾到哪一步了？')
    const text = injected(decision).map((m) => m.content[0].text).join('\n')
    assert.match(text, /\[窗口\]/)
    assert.match(text, /把记忆插件收尾/)
  })

  await check('同一张卡只注入一次', async () => {
    const decision = await preStep(listeners, B, '记忆插件收尾到哪一步了？')
    const texts = injected(decision).map((m) => m.content[0].text)
    if (texts.length) console.log('  注入内容：', texts.join(' || ').slice(0, 400))
    assert.equal(texts.filter((t) => t.includes('[窗口]')).length, 0)
  })

  await check('内容变了才再注入', async () => {
    await tools.get('memory_card').execute({ conclusion: '改成按分支识别工作线' }, { agent: A })
    const decision = await preStep(listeners, B, '记忆插件收尾现在什么结论？')
    assert.match(injected(decision).map((m) => m.content[0].text).join('\n'), /\[窗口\]/)
  })

  await check('BP 场景：另一窗口按线索问到就互见，问无关的就安静', async () => {
    const bp = agent('sess-BP000001', project)
    await tools.get('memory_card').execute({ objective: '整理 BP 大纲' }, { agent: bp })
    const peer = agent('sess-BP000002', project)
    const hit = await preStep(listeners, peer, 'BP 写到哪了？')
    assert.match(injected(hit).map((m) => m.content[0].text).join('\n'), /整理 BP 大纲/)
    const quiet = await preStep(listeners, peer, '今天适合吃点什么')
    assert.equal(injected(quiet).length, 0)
  })

  await check('回声卡不推：别人问过同一句话，不算“另一个窗口的进展”', async () => {
    const q = '另一个窗口的报价说明写到哪了？'
    const peer1 = agent('sess-ECHO0001', project)
    await tools.get('memory_card').execute({ objective: q }, { agent: peer1 })
    const peer2 = agent('sess-ECHO0002', project)
    const decision = await preStep(listeners, peer2, q)
    assert.equal(injected(decision).filter((m) => m.content[0].text.includes('[窗口]')).length, 0)
  })

  await check('多窗口默认关闭：同样的卡，开了才推', async () => {
    const second = makeCtx()
    apply(second.ctx, { repoPath: repo, pullOnStart: false, pushOnTurnEnd: false, minScore: 0.5 })
    const D = agent('sess-DDDDDDDD', project)
    const off = await preStep(second.listeners, D, '记忆插件收尾到哪一步了？')
    assert.equal(injected(off).length, 0)
  })

  await check('无关会话不收卡（同在桌面、但不同工作线）', async () => {
    const C = agent('sess-CCCCCCCC', mkdtempSync(join(tmpdir(), 'plain-memory-other-')))
    const decision = await preStep(listeners, C, '今天适合吃点什么')
    assert.equal(injected(decision).length, 0)
  })

  await check('同文件改动触发重叠提醒', async () => {
    const post = listeners.get('tools/post-execute')[0]
    const exec = (who, path) => ({ agent: who, name: 'write', arguments: { path } })
    await post(exec(A, 'src/index.js'), {}, async () => ({ kind: 'continue' }))
    await post(exec(B, 'src/index.js'), {}, async () => ({ kind: 'continue' }))
    await tools.get('memory_card').execute({ objective: '改 index.js' }, { agent: A })
    const decision = await preStep(listeners, B, '继续')
    const text = injected(decision).map((m) => m.content[0].text).join('\n')
    assert.match(text, /\[重叠\]/)
    assert.match(text, /src\/index\.js/)
  })

  await check('自我层写入先待确认，确认后才落 self.md', async () => {
    const staged = await tools.get('memory_write').execute(
      { layer: 'self', title: '偏好', body: '用户喜欢先看结论再看证据。' },
      { agent: A },
    )
    const id = /提案 (\S+?)。/.exec(staged)[1]
    assert.ok(!readFileSync(join(repo, 'self.md'), 'utf8').includes('先看结论'))
    const confirmed = await tools.get('memory_confirm').execute({ id }, { agent: A })
    assert.match(confirmed, /已写入 self\.md/)
    assert.match(readFileSync(join(repo, 'self.md'), 'utf8'), /先看结论/)
  })

  await check('写入已被插件自动提交（回合结束无须再等）', async () => {
    const read = () => execFileSync('git', ['-C', repo, 'log', '--oneline'], { encoding: 'utf8' })
    const deadline = Date.now() + 4000
    while (Date.now() < deadline && !/memory:/.test(read())) {
      await new Promise((r) => setTimeout(r, 50))
    }
    assert.match(read(), /memory:/)
    const status = execFileSync('git', ['-C', repo, 'status', '--porcelain'], { encoding: 'utf8' })
    assert.equal(status.trim(), '')
  })

  await check('卡片与记忆都在 .state / Markdown 里，.state 不进 git', async () => {
    const tracked = execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8' })
    assert.match(tracked, /self\.md/)
    assert.match(tracked, /semantic\//)
    assert.ok(!tracked.includes('.state'))
  })

  await check('新实例从磁盘恢复索引并召回', async () => {
    const fresh = makeCtx()
    apply(fresh.ctx, { repoPath: repo, pullOnStart: false, pushOnTurnEnd: false })
    const C = agent('sess-CCCCCCCC', project)
    const decision = await preStep(fresh.listeners, C, '注入会破坏缓存吗？')
    assert.ok(injected(decision).some((m) => /KV 缓存|DSH 注入点/.test(m.content[0].text)))
  })

  await check('用户亲口说「记住」时自我层直接写入', async () => {
    const said = {
      session: {
        id: 'sess-DDDDDDDD', header: { cwd: project }, seq: 1,
        eventAt: () => ({ type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: '记住：变量名必须写全称，别用缩写。' }] } }),
      },
    }
    const out = await tools.get('memory_write').execute(
      { layer: 'self', title: '变量名写全称', body: '变量名必须写全称，不用缩写。', cues: '命名,缩写' },
      { agent: said },
    )
    assert.match(out, /已写入 self\.md/)
    assert.match(readFileSync(join(repo, 'self.md'), 'utf8'), /变量名写全称/)
  })

  await check('疑似凭据拒绝写入', async () => {
    const write = tools.get('memory_write')
    await assert.rejects(
      write.execute({ layer: 'semantic', title: '某个 token', body: 'ANTHROPIC_AUTH_TOKEN: test-not-a-real-token-1234', cues: 'token' }, { agent: A }),
      /疑似凭据/,
    )
    await assert.rejects(
      write.execute({ layer: 'semantic', title: '某个 key', body: 'sk-testtesttesttesttesttest', cues: 'key' }, { agent: A }),
      /疑似凭据/,
    )
    const before = readRepo(repo).length
    const ok = await write.execute({ layer: 'semantic', title: '不带值的记录', body: '用过 DeepSeek 的 Anthropic 兼容端点，密钥本身没记。', cues: '端点' }, { agent: A })
    assert.match(ok, /已写入/)
    assert.equal(readRepo(repo).length, before + 1)
  })

  await check('同一窗口同一条记忆只注入一次', async () => {
    const E = agent('sess-EEEEEEEE', project)
    const first = await preStep(listeners, E, '注入会破坏缓存吗？')
    assert.ok(injected(first).length >= 1, '第一次没有召回')
    const second = await preStep(listeners, E, '注入会破坏缓存吗？')
    assert.equal(injected(second).length, 0, '第二次又注入了同一条')
  })

  console.log(`\n${results.length} 项通过`)
} finally {
  rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}
