// 单元自测：不依赖 DSH，直接验证记忆仓内核。用法：node test/core.test.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import {
  appendEntry, buildIndex, entryId, estimateTokens, parseMarkdown, readRepo, recall, splitCues, summarize,
} from '../memory.js'

const repo = mkdtempSync(join(tmpdir(), 'plain-memory-'))
let passed = 0
const check = (label, fn) => { fn(); passed += 1; console.log(`ok ${label}`) }

try {
  check('parseMarkdown 读取元数据与正文', () => {
    const text = '# 主题\n\n### 缓存与注入\n- id: sem-1\n- date: 2026-11-13\n- session: s1\n- cues: 插件, 注入\n- related: sem-2\n\n正文第一行\n第二行\n'
    const [e] = parseMarkdown(text, 'semantic/x.md', 'semantic')
    assert.equal(e.id, 'sem-1')
    assert.equal(e.title, '缓存与注入')
    assert.deepEqual(e.cues, ['插件', '注入'])
    assert.deepEqual(e.related, ['sem-2'])
    assert.equal(e.body, '正文第一行\n第二行')
  })

  check('appendEntry 建文件并追加第二条', () => {
    const base = { layer: 'semantic', date: '2026-11-13', session: 'sess-a', related: [] }
    appendEntry(repo, { ...base, id: entryId('semantic', 'DSH 注入点', '2026-11-13'), title: 'DSH 注入点', cues: ['pre-step', '注入'], body: 'pre-step 瀑布可以追加 user message。' })
    appendEntry(repo, { ...base, id: entryId('semantic', 'DSH 注入点', '2026-11-13') + 'b', title: '第二点', cues: ['缓存'], body: '只追加，不改前缀，KV 缓存不失效。' })
    const entries = readRepo(repo)
    assert.equal(entries.length, 2)
    assert.equal(entries[0].layer, 'semantic')
  })

  check('package.json 无 BOM 且能被严格 JSON.parse 读取', () => {
    const raw = readFileSync(new URL('../package.json', import.meta.url), 'utf8')
    assert.ok(!raw.startsWith('\uFEFF'), 'package.json 开头有 BOM；宿主的 JSON.parse 会报 "Unexpected token"，插件会显示「包不可用」')
    const pkg = JSON.parse(raw)
    assert.equal(pkg.name, 'dsh-plain-memory')
    assert.ok(pkg.version, 'version 缺失')
  })

  check('中文二元组召回', () => {
    const entries = readRepo(repo)
    const index = buildIndex(entries)
    const hits = recall(index, 'pre-step 注入是怎么实现的？', 3, 0.3)
    assert.ok(hits.length >= 1)
    assert.equal(hits[0].entry.title, 'DSH 注入点')
  })

  check('单个线索不召回（默认要 2 个独立线索）', () => {
    const index = buildIndex(readRepo(repo))
    const hits = recall(index, '注入', 3, 0.3)
    assert.equal(hits.length, 0)
  })

  check('过期记忆不召回', () => {
    writeFileSync(join(repo, 'semantic', 'expired.md'),
      '### 过期的截止日\n- id: sem-exp\n- date: 2026-01-01\n- session: s\n- cues: 截止, 交稿\n- expires: 2000-01-01\n\n交稿截止日是 2000-01-01。\n')
    const index = buildIndex(readRepo(repo))
    const hits = recall(index, '交稿截止是哪天？', 3, 0.2)
    assert.ok(!hits.some((h) => h.entry.id === 'sem-exp'))
    const kept = recall(index, '交稿截止是哪天？', 3, 0.2, 1)
    assert.ok(!kept.some((h) => h.entry.id === 'sem-exp'), '过期条目在低阈值下也不该出现')
    rmSync(join(repo, 'semantic', 'expired.md'), { force: true })
  })

  check('无关消息不召回', () => {
    const index = buildIndex(readRepo(repo))
    const hits = recall(index, '今天天气不错，去跑步', 3, 1.0)
    assert.equal(hits.length, 0)
  })

  check('一跳关联召回', () => {
    appendEntry(repo, { id: 'sem-a', layer: 'semantic', title: '甲', date: '2026-11-13', session: 's', cues: ['阿尔法'], related: ['sem-b'], body: '甲的内容' })
    appendEntry(repo, { id: 'sem-b', layer: 'semantic', title: '乙', date: '2026-11-13', session: 's', cues: ['贝塔'], related: [], body: '乙的内容' })
    const index = buildIndex(readRepo(repo))
    const hits = recall(index, '阿尔法', 3, 0.5, 1)
    assert.ok(hits.some((h) => h.entry.id === 'sem-b' && h.hop))
  })

  check('splitCues 兼容中文逗号顿号', () => {
    assert.deepEqual(splitCues('插件，注入、缓存 测试'), ['插件', '注入', '缓存', '测试'])
  })

  check('summarize 截断并标明可读全文', () => {
    const text = summarize({ body: 'x'.repeat(300) }, 20)
    assert.ok(text.startsWith('x'.repeat(18)))
    assert.ok(text.includes('memory_recall'))
    assert.ok(text.length <= 60)
  })

  check('estimateTokens 对中文按字计', () => {
    assert.ok(estimateTokens('记忆插件') >= 4)
    assert.ok(estimateTokens('memory plugin') >= 3)
  })

  console.log(`\n${passed} 项通过`)
} finally {
  rmSync(repo, { recursive: true, force: true })
}


