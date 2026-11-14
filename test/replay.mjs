// 离线重放：对真实记忆仓跑召回，打印分词、每条得分、阈值判断。
// 用法：node test/replay.mjs <记忆仓路径> <问题...>
import { buildIndex, readRepo, recall, recallAll, tokenize } from '../memory.js'

const [repo, ...questions] = process.argv.slice(2)
// 与插件一致：自我层由 AGENTS.md 开局加载，不进召回索引
const entries = readRepo(repo).filter((e) => e.layer !== 'self')
const index = buildIndex(entries)
console.log(`条目 ${entries.length}；词表 ${index.df.size}`)
for (const e of entries) console.log(`  - ${e.id} | ${e.title} | cues: ${e.cues.join(',')}`)

for (const q of questions) {
  const hits = recallAll(index, q, 3, 0.3)
  console.log(`\n问：${q}`)
  console.log(`分词(${new Set(tokenize(q)).size})：${[...new Set(tokenize(q))].slice(0, 24).join(' ')}`)
  const scored = index.docs.map((doc) => {
    let acc = 0
    const toks = new Set(tokenize(q))
    let total = 0
    for (const t of toks) {
      const df = index.df.get(t)
      if (!df) continue
      total += Math.log(1 + (index.size - df + 0.5) / (df + 0.5))
    }
    for (const t of toks) {
      const tf = doc.tf.get(t)
      if (!tf) continue
      const df = index.df.get(t)
      const idf = Math.log(1 + (index.size - df + 0.5) / (df + 0.5))
      acc += idf * (tf / (tf + 1.2 * (0.25 + 0.75 * doc.len / index.avgdl)))
    }
    return { title: doc.entry.title, score: total > 0 ? acc / total : 0, matched: [...toks].filter((t) => doc.tf.has(t)).length }
  }).sort((a, b) => b.score - a.score)
  console.log('得分：', scored.map((s) => `${s.title.slice(0, 12)}=${s.score.toFixed(3)}(${s.matched}词)`).join(' | '))
  console.log('命中：', hits.length ? hits.map((h) => `${h.entry.title} ${h.score.toFixed(3)}`).join(' / ') : '无')
}
