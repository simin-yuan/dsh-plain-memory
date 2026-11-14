// 跨领域唤起：5 组「经历用一套词写，提问用另一套词说」的用例。
// 用法：node test/e2e/cross-domain.mjs
import { buildIndex, recall } from '../../memory.js'

const CASES = [
  {
    memory: '给上游仓库的补丁附了一键复现脚本，维护者当天就合并了。',
    cues: '复现, 评审, 信任, 成本',
    question: '怎么让比赛评委更重视我的提交',
  },
  {
    memory: '注入失效时加了一条告警，不再静默失败。',
    cues: '告警, 失败, 监控',
    question: '系统坏了却没人发现怎么办',
  },
  {
    memory: '记忆存成纯 Markdown，换工具也能读。',
    cues: '迁移, 备份, 格式',
    question: '以后换电脑这些资料还能用吗',
  },
  {
    memory: 'push 改到后台，网络慢也不卡回合。',
    cues: '卡住, 超时, 网络',
    question: '为什么界面有时候会一直转圈',
  },
  {
    memory: '两个窗口同时写会抢锁，改成一条记忆一个文件。',
    cues: '并发, 冲突, 锁, 覆盖',
    question: '同时开两个程序改同一份东西会怎样',
  },
]

const NOISE = [
  '今晚吃什么',
  '帮我写一个快速排序',
  '解释一下量子纠缠',
  '推荐一部周末看的电影',
  '这个函数为什么报错',
  '把这段话翻译成英文',
]

const entries = CASES.map((c, i) => ({
  id: `case-${i}`, layer: 'episodic', title: `经历 ${i + 1}`, date: '2026-11-13',
  session: `s${i}`, cues: c.cues.split(/[,，、]\s*/), related: [], body: c.memory, file: `episodic/case-${i}.md`,
}))
const index = buildIndex(entries)

let hits = 0
const rows = []
CASES.forEach((c, i) => {
  const got = recall(index, c.question, 3, 0.3)
  const top = got[0]
  const ok = top?.entry.id === `case-${i}`
  if (ok) hits += 1
  rows.push({ n: i + 1, hit: ok ? '✓' : '✗', top: top ? `${top.entry.id} ${top.score.toFixed(2)}` : '-' })
})
const falsePositives = NOISE.filter((q) => recall(index, q, 3, 0.3).length > 0)

console.table(rows)
console.log(`命中 ${hits}/${CASES.length}；无关提问误召回 ${falsePositives.length}/${NOISE.length}`)
if (falsePositives.length) console.log('误召回：', falsePositives.join(' | '))
if (hits < 3) {
  console.error('命中低于 3/5，按约定先改线索词编码提示再重测，不装机。')
  process.exitCode = 1
}
