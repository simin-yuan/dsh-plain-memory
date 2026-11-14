// 并发写入的子进程：往同一个记忆仓写 N 条不同记忆并提交。
// 用法：node worker-write.mjs <repo> <前缀> <条数>
import { appendEntry, buildIndex, entryId, readRepo } from '../../memory.js'
import { commit } from '../../git.js'

const [repo, prefix, countArg] = process.argv.slice(2)
const count = Number(countArg || 10)

const written = []
for (let i = 0; i < count; i += 1) {
  const title = `${prefix}-${i}`
  const date = '2026-11-13'
  const entry = {
    id: entryId('semantic', title, date), layer: 'semantic', title, date,
    session: prefix, cues: [`并发${i}`, '写入'], related: [],
    body: `${prefix} 的第 ${i} 条并发写入。`,
  }
  written.push(appendEntry(repo, entry))
}

const result = await commit(repo, `memory(concurrency): ${prefix} ${count} 条`)
const entries = readRepo(repo)
console.log(JSON.stringify({ prefix, written: written.length, entries: entries.length, commit: result }))
