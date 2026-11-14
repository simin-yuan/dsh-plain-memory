/**
 * Markdown 记忆仓的内核：解析、BM25 召回、追加写入。零依赖。
 *
 * 目录约定（全部是纯 Markdown）：
 *   self.md                 自我层（身份、偏好、长期约束；需用户确认）
 *   episodic/YYYY-MM.md     情景层（做过什么、结论是什么）
 *   semantic/<主题>.md      语义层（跨会话可复用的事实与方法）
 *   .state/                 运行时状态（状态卡、待确认提案），已被 .gitignore
 *
 * 每条记忆是一个 `### 标题` 小节，元数据行固定为：
 *   - id / date / session / cues / related
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, relative } from 'node:path'

const K1 = 1.2
const B = 0.75
const MAX_BODY = 600
/** 记忆召回至少要两个不同的匹配词才算想起来；状态卡因为条数少、且 24 小时就过期，只要求 1 个。 */
export const MIN_MATCHED_TERMS = 2

/** 本地日期，YYYY-MM-DD。 */
export function today(now = new Date()) {
  const p = (n) => String(n).padStart(2, '0')
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`
}

/** 文件名安全的短标识；保留中文，去掉路径与空白。 */
export function slug(text) {
  const s = String(text || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return s || 'memory'
}

/** 稳定条目 id：层-日期-内容短哈希。 */
export function entryId(layer, title, date) {
  let h = 0
  const s = `${layer}:${title}:${date}`
  for (let i = 0; i < s.length; i += 1) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0
  return `${layer}-${date.replace(/-/g, '')}-${h.toString(36)}`
}

function metadata(entry) {
  const lines = [
    `- id: ${entry.id}`,
    `- date: ${entry.date}`,
    `- session: ${entry.session}`,
  ]
  if (entry.cues && entry.cues.length) lines.push(`- cues: ${entry.cues.join(', ')}`)
  if (entry.related && entry.related.length) lines.push(`- related: ${entry.related.join(', ')}`)
  return lines.join('\n')
}

/** 一条记忆的 Markdown 文本。 */
export function formatEntry(entry) {
  const body = String(entry.body || '').trim().slice(0, MAX_BODY)
  return `${metadata(entry)}\n\n${body}\n`
}

/**
 * 一条记忆一个文件：并发写不同记忆时不会互相覆盖。
 * 同名同日重复写入落到同一个文件（幂等覆盖），不会堆出重复条目。
 */
function targetFile(entry) {
  if (entry.layer === 'self') return 'self.md'
  const dir = entry.layer === 'episodic' ? 'episodic' : 'semantic'
  const suffix = String(entry.id).slice(-4)
  return `${dir}/${entry.date}-${slug(entry.title)}-${suffix}.md`
}

function headerFor(layer) {
  return layer === 'self'
    ? '# 自我\n\n长期有效的身份、偏好与约束。只有用户明确确认过的内容才能写在这里。\n'
    : ''
}

const META = /^- (id|date|session|cues|related):\s*(.*)$/

/** 解析一个 Markdown 文件里的全部条目。HTML 注释整段跳过，避免把示例当成记忆。 */
export function parseMarkdown(text, file, layer) {
  const entries = []
  let cur = null
  let bodyStarted = false
  let inComment = false
  for (const raw of text.split(/\r?\n/)) {
    let line = raw
    if (inComment) {
      if (line.includes('-->')) { inComment = false; line = line.slice(line.indexOf('-->') + 3) }
      else continue
    }
    while (line.includes('<!--')) {
      const start = line.indexOf('<!--')
      const end = line.indexOf('-->', start)
      if (end === -1) { line = line.slice(0, start); inComment = true; break }
      line = line.slice(0, start) + line.slice(end + 3)
    }
    if (line.startsWith('### ')) {
      if (cur) entries.push(cur)
      cur = { title: line.slice(4).trim(), meta: {}, bodyLines: [], file, layer }
      bodyStarted = false
      continue
    }
    if (!cur) continue
    const m = META.exec(line)
    if (!bodyStarted && m) { cur.meta[m[1]] = m[2].trim(); continue }
    if (!bodyStarted && line.trim() === '') { bodyStarted = true; continue }
    bodyStarted = true
    cur.bodyLines.push(line)
  }
  if (cur) entries.push(cur)
  return entries.map((e) => ({
    id: e.meta.id || entryId(e.layer, e.title, e.meta.date || today()),
    layer: e.layer,
    title: e.title,
    date: e.meta.date || '',
    session: e.meta.session || '',
    cues: splitCues(e.meta.cues || ''),
    related: splitCues(e.meta.related || ''),
    body: e.bodyLines.join('\n').trim(),
    file: e.file,
  }))
}

/** 逗号、顿号、空白都算线索词分隔符。 */
export function splitCues(text) {
  return String(text || '')
    .split(/[,，、;；\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .slice(0, 12)
}

function layerOf(rel) {
  if (basename(rel) === 'self.md') return 'self'
  if (rel.split(/[\\/]/)[0] === 'episodic') return 'episodic'
  return 'semantic'
}

/** 读取整个记忆仓的条目（跳过 README 与 .state）。 */
export function readRepo(repo) {
  const out = []
  const walk = (dir) => {
    let names
    try { names = readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const d of names) {
      if (d.name.startsWith('.') || d.name === 'node_modules') continue
      const full = join(dir, d.name)
      if (d.isDirectory()) { walk(full); continue }
      if (!d.name.endsWith('.md') || d.name === 'README.md') continue
      const rel = relative(repo, full).replaceAll('\\', '/')
      let text = ''
      try { text = readFileSync(full, 'utf8') } catch { continue }
      out.push(...parseMarkdown(text, rel, layerOf(rel)))
    }
  }
  walk(repo)
  return out
}

/**
 * 功能词与套话：只出现在提问里、不指向任何记忆的词。不滤掉它们，
 * 「帮我写一个快速排序」会因为记忆里有一句「一个文件」而误召回。
 */
const STOPWORDS = new Set([
  '一个', '这个', '那个', '这些', '那些', '我们', '你们', '他们', '她们', '它们', '自己',
  '什么', '怎么', '为什', '什幺', '可以', '可能', '应该', '需要', '因为', '所以', '但是',
  '如果', '虽然', '然后', '现在', '已经', '还是', '或者', '而且', '不过', '就是', '不是',
  '没有', '有没', '时候', '一些', '这样', '那样', '这种', '那种', '东西', '事情', '地方',
  '帮我', '我的', '你的', '他的', '她的', '一下', '一点', '非常', '特别', '其实', '只是',
  '还有', '以及', '对于', '关于', '通过', '进行', '正在', '一直', '有时', '怎样', '如何',
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'is', 'are',
  'was', 'were', 'be', 'it', 'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she',
  'we', 'they', 'my', 'your', 'his', 'her', 'our', 'their',
])

function informative(token) {
  return token.startsWith('+') || !STOPWORDS.has(token)
}

/**
 * 概念桥：把同一个意思的不同说法折到组首那个词上。这是纯词表，不是语义模型，
 * 所以只在「用户换了个说法」时起作用，不能理解没收录的说法——这一点写进 README。
 * 命中后追加带 `+` 前缀的概念 token，打分按 0.6 计权。
 */
const CONCEPTS = [
  ['卡住', ['卡住', '转圈', '无响应', '冻结', 'hang']],
  ['超时', ['超时', 'timeout', '等了很久']],
  ['迁移', ['换电脑', '迁移', '搬家', 'migrate']],
  ['并发', ['同时', '并发', '并行', '一起', 'concurrent']],
  ['失败', ['坏了', '失败', '故障', '挂了', '失败', 'error']],
  ['告警', ['发现', '察觉', '监控', '告警', '报警', 'alert']],
  ['评审', ['评审', '评委', '审阅', 'review', 'reviewer']],
  ['复现', ['复现', '重现', '复刻', 'reproduce']],
  ['信任', ['信任', '可信', 'trust', 'credit']],
  ['成本', ['成本', '代价', '开销', 'cost']],
  ['验证', ['验证', '检验', '核对', 'verify']],
  ['缓存', ['缓存', 'cache']],
  ['文档', ['文档', '说明', '注释', 'docs', 'documentation']],
  ['性能', ['性能', '速度', '延迟', 'latency', 'performance']],
  ['依赖', ['依赖', 'dependency']],
  ['配置', ['配置', 'config']],
  ['记忆', ['记忆', 'memory']],
  ['会话', ['窗口', '会话', 'session']],
  ['测试', ['测试', 'test']],
  ['发布', ['部署', '发布', '上线', 'deploy', 'release']],
  ['权限', ['权限', '授权', 'permission']],
  ['脚本', ['脚本', '批量', '自动', 'script']],
  ['锁', ['锁', 'lock', '占用']],
]

/** 分词：ASCII 词 + 中文二元组 + 概念桥展开（带 `+` 前缀）。 */
export function tokenize(text) {
  const s = String(text || '').toLowerCase()
  const tokens = s.match(/[a-z0-9][a-z0-9_+.#/-]*/g) || []
  const cjk = s.match(/[\u3400-\u4dbf\u4e00-\u9fff]+/g) || []
  for (const run of cjk) {
    if (run.length === 1) { tokens.push(run); continue }
    for (let i = 0; i < run.length - 1; i += 1) tokens.push(run.slice(i, i + 2))
  }
  for (const [head, terms] of CONCEPTS) {
    if (terms.some((term) => s.includes(term))) tokens.push(`+${head}`)
  }
  return tokens
}

/** 建立 BM25 索引。 */
export function buildIndex(entries) {
  const docs = entries.map((e) => {
    const tf = new Map()
    const tokens = tokenize(`${e.title} ${e.cues.join(' ')} ${e.body}`).filter(informative)
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1)
    return { entry: e, tf, len: tokens.length }
  })
  const df = new Map()
  for (const d of docs) for (const t of d.tf.keys()) df.set(t, (df.get(t) || 0) + 1)
  const avgdl = docs.length === 0 ? 0 : docs.reduce((n, d) => n + d.len, 0) / docs.length
  return { docs, df, avgdl: avgdl || 1, size: docs.length, byId: new Map(entries.map((e) => [e.id, e])) }
}

function idf(index, term) {
  const df = index.df.get(term) || 0
  return Math.log(1 + (index.size - df + 0.5) / (df + 0.5))
}

/**
 * 召回分数是"这条查询里落在文档上的信息量占比"（0–1），因此不随语料规模漂移：
 * 同一个阈值在 1 条记忆和 500 条记忆的仓库里含义一致。
 * 在 4 条以上的语料里，出现在 60% 以上文档中的词按停用词处理。
 *
 * 「两个独立线索」：一条记忆至少要有 2 个不同的匹配词才算想起来。
 * 记忆少的时候 IDF 分不开常用词和关键词，单个泛词（记忆/工具/下周）也能过阈值；
 * 人回忆时也是两三个线索同时对上才确定。只命中 1 个词 → 不注入，模型仍可主动 memory_recall。
 * @returns {{entry: object, score: number, hop: boolean}[]}
 */
export function recall(index, text, limit, minScore = 0.3, minMatched = 1) {
  if (!index || index.size === 0) return []
  const terms = [...new Set(tokenize(text))].filter((t) => {
    if (!informative(t)) return false
    const df = index.df.get(t)
    if (!df) return false
    return !(index.size >= 4 && df >= index.size * 0.6)
  })
  if (terms.length === 0) return []
  const weightOf = (t) => (t.startsWith('+') ? 0.6 : 1)
  const total = terms.reduce((n, t) => n + idf(index, t) * weightOf(t), 0)
  if (total <= 0) return []
  // 每个匹配词在查询里的位置；用来把重叠的二元组折成一个线索（「报价/价说/说明」算 1 个）
  const lower = String(text || '').toLowerCase()
  const at = new Map(terms.map((t) => [t, t.startsWith('+') ? -1 : lower.indexOf(t)]))
  const independent = (matchedTerms) => {
    const sorted = [...matchedTerms].sort((a, b) => (at.get(a) ?? -1) - (at.get(b) ?? -1))
    let n = 0
    let end = -1
    for (const t of sorted) {
      const p = at.get(t) ?? -1
      if (p < 0) { n += 1; continue }
      if (p <= end) continue
      n += 1
      end = p + t.length - 1
    }
    return n
  }
  const scored = index.docs
    .map((doc) => {
      let acc = 0
      const hits = []
      for (const t of terms) {
        const tf = doc.tf.get(t)
        if (!tf) continue
        hits.push(t)
        acc += idf(index, t) * weightOf(t) * (tf / (tf + K1 * (1 - B + (B * doc.len) / index.avgdl)))
      }
      return { entry: doc.entry, score: acc / total, matched: independent(hits) }
    })
    .filter((r) => r.score >= minScore && r.matched >= minMatched)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
  const out = scored.map((r) => ({ ...r, hop: false }))
  const seen = new Set(out.map((r) => r.entry.id))
  for (const hit of scored) {
    for (const rel of hit.entry.related) {
      const linked = index.byId.get(rel)
      if (!linked || seen.has(linked.id)) continue
      seen.add(linked.id)
      out.push({ entry: linked, score: hit.score * 0.5, hop: true })
      break
    }
  }
  return out.slice(0, limit + 1)
}

/**
 * 长消息按句子切开分别召回，再按条目合并取最高分。
 * 十个问题挤在一条消息里时，整段当查询会被稀释到阈值以下；切开就恢复成十个短查询。
 * 整段也保留一次，避免跨句的主题被漏掉。
 * @returns {{entry: object, score: number, hop: boolean}[]}
 */
export function recallAll(index, text, limit, minScore = 0.3, minMatched = 1) {
  if (!index || index.size === 0) return []
  const raw = String(text || '')
  const segments = raw.split(/[。！？!?；;\n]+/).map((s) => s.trim()).filter((s) => s.length >= 2)
  const queries = [...segments.slice(0, 12), raw]
  const best = new Map()
  for (const query of queries) {
    for (const hit of recall(index, query, limit, minScore, minMatched)) {
      const prev = best.get(hit.entry.id)
      if (!prev || hit.score > prev.score) best.set(hit.entry.id, hit)
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score).slice(0, limit)
}

function writeAtomic(file, text) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  try { renameSync(tmp, file) } catch { writeFileSync(file, text, 'utf8') }
}

/** 写入一条记忆。非自我层一条一个文件，并发写不同记忆互不覆盖。 */
export function appendEntry(repo, entry) {
  const rel = targetFile(entry)
  const file = join(repo, rel)
  mkdirSync(dirname(file), { recursive: true })
  if (entry.layer !== 'self') {
    writeAtomic(file, `### ${entry.title}\n${formatEntry(entry)}`)
    return rel
  }
  const head = existsSync(file) ? readFileSync(file, 'utf8') : headerFor(entry.layer)
  writeAtomic(file, `${head.replace(/\s*$/, '')}\n\n### ${entry.title}\n${formatEntry(entry)}`)
  return rel
}

/**
 * 条目的一句话展示文本。截断时优先停在句号/分号处，保住前面的要点，
 * 并在末尾标明全文还能用 memory_recall 读到——不让最有用的一条被腰斩。
 */
export function summarize(entry, maxChars = 160) {
  const body = entry.body.replace(/\s+/g, ' ').trim()
  if (body.length <= maxChars) return body
  const cut = body.slice(0, maxChars)
  const stop = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('；'), cut.lastIndexOf(';'), cut.lastIndexOf('. '))
  const kept = stop > maxChars * 0.45 ? cut.slice(0, stop + 1) : cut
  return `${kept.trim()}…（全文可用 memory_recall 读取）`
}

/** 粗略 token 估算：中文按 1 token/字，ASCII 按 4 字符/token。 */
export function estimateTokens(text) {
  const cjk = (text.match(/[\u3400-\u4dbf\u4e00-\u9fff]/g) || []).length
  return Math.ceil(cjk + (text.length - cjk) / 4)
}

/** 疑似凭据的形态。命中即拒写；宁可误拒，也不让密钥进记忆仓。 */
const SECRET_PATTERNS = [
  ['OpenAI/DeepSeek 风格的 sk- 密钥', /\bsk-[A-Za-z0-9_-]{20,}/],
  ['GitHub 令牌', /\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/],
  ['JWT / 账号令牌', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/],
  ['Bearer 令牌', /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}/],
  ['密钥/令牌赋值', /(?:ANTHROPIC_AUTH_TOKEN|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|OPENAI_API_KEY|api[_-]?key|access[_-]?token|client[_-]?secret|password)["']?\s*[:=]\s*["']?[A-Za-z0-9._~+\/-]{16,}/i],
  ['AWS 访问密钥', /\bAKIA[0-9A-Z]{16}\b/],
  ['私钥块', /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----/],
]

/**
 * 检查一段文本里有没有疑似凭据。
 * @returns {string|null} 命中的类型名，没有则 null。
 */
export function findSecret(text) {
  const s = String(text || '')
  for (const [kind, re] of SECRET_PATTERNS) if (re.test(s)) return kind
  return null
}
