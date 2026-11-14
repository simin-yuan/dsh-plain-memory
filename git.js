/**
 * 最小 git 封装：只做记忆仓需要的 pull / commit / push。
 *
 * 三条纪律，都是为了「不挡回合、不打断对话」：
 *   1. 所有调用都有超时，且禁止交互（GIT_TERMINAL_PROMPT=0、GCM_INTERACTIVE=never）。
 *   2. 提交遇到 index.lock 时退避重试；仍失败就把改动留在工作区，下次提交带上。
 *   3. 推送在后台跑，回合不等它；失败只记日志，下次再补推。
 */

import { execFile, spawn } from 'node:child_process'

const PULL_MS = 5_000
const COMMIT_MS = 5_000
const PUSH_MS = 15_000

function gitEnv() {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GCM_INTERACTIVE: 'never',
    GIT_OPTIONAL_LOCKS: '0',
  }
}

/** 跑一条 git 命令；永远 resolve，不抛。 */
export function runGit(repo, args, timeoutMs = COMMIT_MS) {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-C', repo, ...args],
      { timeout: timeoutMs, windowsHide: true, maxBuffer: 4 * 1024 * 1024, env: gitEnv() },
      (error, stdout, stderr) => {
        resolve({
          ok: error === null,
          code: typeof error?.code === 'number' ? error.code : error === null ? 0 : 1,
          out: String(stdout || '').trim(),
          err: String(stderr || '').trim(),
          timedOut: error?.killed === true,
        })
      },
    )
  })
}

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms) })

/** 是否是一个 git 工作树。 */
export async function isRepo(repo) {
  const r = await runGit(repo, ['rev-parse', '--is-inside-work-tree'], 4_000)
  return r.ok && r.out === 'true'
}

/** 工作树根目录。 */
export async function topLevel(repo) {
  const r = await runGit(repo, ['rev-parse', '--show-toplevel'], 4_000)
  return r.ok ? r.out : ''
}

/** 目录所在的 git 分支；不是仓库（或 detached）就返回空串。用它当「工作线」。 */
export async function branchOf(dir) {
  const r = await runGit(dir, ['symbolic-ref', '--short', 'HEAD'], 4_000)
  return r.ok ? r.out : ''
}

/** 是否有未提交改动。 */
export async function isDirty(repo) {
  const r = await runGit(repo, ['status', '--porcelain'], COMMIT_MS)
  return r.ok && r.out.length > 0
}

/** 拉取（只快进）。 */
export async function pull(repo) {
  const r = await runGit(repo, ['pull', '--ff-only', '--quiet'], PULL_MS)
  return { ok: r.ok, detail: r.ok ? '' : (r.err || r.out).slice(0, 200) }
}

/**
 * 提交全部改动。撞上另一个窗口的 index.lock 时退避重试；
 * 重试仍失败就把改动留在工作区并返回失败，由下次提交带上。
 */
export async function commit(repo, message, attempts = 3) {
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const add = await runGit(repo, ['add', '-A'], COMMIT_MS)
    if (!add.ok) return { ok: false, committed: false, detail: (add.err || add.out).slice(0, 200) }
    const done = await runGit(repo, ['commit', '-m', message, '--quiet'], COMMIT_MS)
    if (done.ok) return { ok: true, committed: true, detail: '' }
    const text = `${done.err}\n${done.out}`
    if (/nothing to commit|no changes added/i.test(text)) return { ok: true, committed: false, detail: '' }
    const locked = /index\.lock|Another git process|Unable to create|File exists/i.test(text)
    if (locked && attempt < attempts) {
      await sleep(150 * attempt)
      continue
    }
    return { ok: false, committed: false, detail: text.trim().slice(0, 200) }
  }
  return { ok: false, committed: false, detail: 'commit retries exhausted' }
}

/** 后台推送：分离子进程，回合不等它，父进程退出也不等。 */
export function pushBackground(repo) {
  try {
    const child = spawn('git', ['-C', repo, 'push', '--quiet'], {
      env: gitEnv(),
      stdio: 'ignore',
      windowsHide: true,
      detached: true,
    })
    child.unref()
    return true
  } catch {
    return false
  }
}

/** 同步等待的推送，只给进程收尾用；超时即放弃。 */
export async function pushNow(repo) {
  const r = await runGit(repo, ['push', '--quiet'], PUSH_MS)
  return { ok: r.ok, detail: r.ok ? '' : (r.err || r.out).slice(0, 200) }
}
