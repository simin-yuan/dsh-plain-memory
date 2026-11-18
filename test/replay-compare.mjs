// 离线重放：拿真实使用日志当查询集，对比「修之前/修之后」的召回参数。
// 用法：node test/replay-compare.mjs <记忆仓> <recall.log> [选项]
//   --split=1|0    自动注入是否按句切开（修之前=1）
//   --min=1|2      至少要几个独立线索（修之前=1）
//   --hop=1|0      概念桥关联跳转是否参与（修之前=1）
//   --dedupe=1|0   同一会话内同一标题只算一次（默认 1，模拟生产去重）
//   --out=<file>   把聚合结果写成 JSON
//   --sample=<n>   把前 n 条 top-1 命中写成 Markdown 抽样表（给人判相关性）
import { readFileSync, writeFileSync } from 'node:fs'
import { buildIndex, readRepo, recallAll } from '../memory.js'

const [repo, logPath] = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`))
  return hit === undefined ? fallback : hit.slice(name.length + 3)
}
const split = flag('split', '1') === '1'
const minMatched = Number(flag('min', '1'))
const hop = flag('hop', '1') === '1'
const countConcept = flag('concept', '0') === '1'
const dedupe = flag('dedupe', '1') === '1'
const out = flag('out', '')
const sampleN = Number(flag('sample', '0'))

const entries = readRepo(repo).filter((e) => e.layer !== 'self')
const indexCache = new Map()
const indexFor = (day) => {
  if (indexCache.has(day)) return indexCache.get(day)
  // 时间切片：只用「提问那天已经存在」的记忆，避免未来的条目污染历史查询
  const slice = entries.filter((e) => !e.date || e.date <= day)
  const idx = buildIndex(slice)
  indexCache.set(day, idx)
  return idx
}

const events = readFileSync(logPath, 'utf8').split(/\r?\n/).filter((l) => l.trim())
  .map((l) => { try { return JSON.parse(l) } catch { return null } })
  .filter((e) => e && e.q && e.at)
  .sort((a, b) => a.at.localeCompare(b.at))

const perSession = new Map()
const counts = new Map()
const rows = []
let injectedItems = 0
let hitEvents = 0
let zeroEvents = 0
let bpCount = 0
let bpTop1 = 0
const BP = 'episodic-20261113-u1l2ww'

for (const ev of events) {
  const day = ev.at.slice(0, 10)
  const index = indexFor(day)
  let hits = recallAll(index, ev.q, 3, 0.3, minMatched, { split, hop, countConcept })
  if (dedupe) {
    const seen = perSession.get(ev.session) || new Set()
    perSession.set(ev.session, seen)
    hits = hits.filter((h) => {
      if (seen.has(h.entry.title)) return false
      seen.add(h.entry.title)
      return true
    })
  }
  if (hits.length === 0) { zeroEvents += 1; continue }
  hitEvents += 1
  injectedItems += hits.length
  for (const h of hits) counts.set(h.entry.id, (counts.get(h.entry.id) || 0) + 1)
  if (hits.some((h) => h.entry.id === BP)) bpCount += 1
  if (hits[0].entry.id === BP) bpTop1 += 1
  rows.push({
    at: ev.at.slice(5, 16),
    q: ev.q.slice(0, 80),
    title: hits[0].entry.title,
    score: Number(hits[0].score.toFixed(3)),
    terms: (hits[0].terms || []).join(' '),
    count: hits.length,
  })
}

const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1])
const top5 = sorted.slice(0, 5).reduce((n, [, c]) => n + c, 0)
const summary = {
  params: { split, minMatched, hop, dedupe, countConcept },
  events: events.length,
  hitEvents,
  zeroEvents,
  zeroRatio: Number((zeroEvents / events.length).toFixed(3)),
  injectedItems,
  avgPerHitEvent: Number((injectedItems / Math.max(1, hitEvents)).toFixed(2)),
  distinctEntries: sorted.length,
  top5Share: Number((top5 / Math.max(1, injectedItems)).toFixed(3)),
  bpCount,
  bpTop1,
  top10: sorted.slice(0, 10).map(([id, c]) => `${id}:${c}`),
}

console.log(JSON.stringify(summary, null, 2))
if (out) writeFileSync(out, `${JSON.stringify(summary, null, 2)}\n`, 'utf8')

if (sampleN > 0) {
  const step = Math.max(1, Math.floor(rows.length / sampleN))
  const picked = rows.filter((_, i) => i % step === 0).slice(0, sampleN)
  const lines = [
    '# 重放抽样：新召回器的 top-1 命中（人工判相关性用）',
    '',
    `参数：split=${split} min=${minMatched} hop=${hop} concept=${countConcept}；共 ${events.length} 条真实提问，命中 ${hitEvents} 条，注入 ${injectedItems} 条。`,
    '',
    '| # | 时间 | 提问（截断） | 注入的 top-1 | 分数 | 命中词 | 我的判断（真/假） |',
    '|---|---|---|---|---|---|---|',
    ...picked.map((r, i) => `| ${i + 1} | ${r.at} | ${r.q.replaceAll('|', '/')} | ${r.title.replaceAll('|', '/')} | ${r.score} | ${r.terms.replaceAll('|', '/')} |  |`),
  ]
  const file = flag('sample', '') ? out.replace(/\.json$/, '') + '-sample.md' : 'replay-sample.md'
  writeFileSync(file, `${lines.join('\n')}\n`, 'utf8')
  console.log(`\n抽样表：${file}`)
}

