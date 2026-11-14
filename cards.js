/**
 * 窗口状态卡：每个活跃 DSH 会话一张，落在记忆仓的 .state/cards/ 下。
 * 卡片是运行时协调数据，不是记忆资产，所以被 .state/.gitignore 排除，不进 git。
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const CARD_VERSION = 1

function stateDir(repo) {
  return join(repo, '.state')
}

/** 确保 .state 存在且被 git 忽略。 */
export function ensureState(repo) {
  const dir = stateDir(repo)
  mkdirSync(join(dir, 'cards'), { recursive: true })
  mkdirSync(join(dir, 'pending'), { recursive: true })
  const ignore = join(dir, '.gitignore')
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n', 'utf8')
  return dir
}

function cardFile(repo, sessionId) {
  return join(stateDir(repo), 'cards', `${String(sessionId).replace(/[^\w.-]/g, '_')}.json`)
}

function clip(text, max) {
  const s = String(text || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? s.slice(0, max - 1) : s
}

/** 写一张状态卡（原子替换）。 */
export function writeCard(repo, card) {
  const dir = ensureState(repo)
  const file = cardFile(repo, card.session)
  const value = {
    v: CARD_VERSION,
    session: String(card.session),
    cwd: clip(card.cwd, 200),
    line: clip(card.line, 80),
    lineExplicit: card.lineExplicit === true,
    files: (card.files || []).slice(0, 12).map((f) => clip(f, 160)),
    objective: clip(card.objective, 300),
    conclusion: clip(card.conclusion, 300),
    updatedAt: Number(card.updatedAt) || Date.now(),
  }
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
  try { renameSync(tmp, file) } catch { writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8') }
  return dir
}

/** 读全部状态卡；坏文件直接跳过。 */
export function readCards(repo) {
  const dir = join(stateDir(repo), 'cards')
  let names = []
  try { names = readdirSync(dir) } catch { return [] }
  const out = []
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    try {
      const card = JSON.parse(readFileSync(join(dir, name), 'utf8'))
      if (card && typeof card.session === 'string') out.push(card)
    } catch { /* 半写入的卡片下一轮会被覆盖 */ }
  }
  return out
}
