// 端到端测试的公共部分：真 DSH headless + 假模型服务器。
// 需要环境变量 DSH_APP_HOME 指向 DSH 安装目录（里面有 "DeepSeek Harness.exe"）。
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { startMockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

export const PLUGIN_ENTRY = fileURLToPath(new URL('../../index.js', import.meta.url))
export const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url))

export function appPaths() {
  const home = process.env.DSH_APP_HOME
  if (!home) throw new Error('设置 DSH_APP_HOME 指向 DSH 安装目录（含 "DeepSeek Harness.exe"）')
  return {
    exe: join(home, 'DeepSeek Harness.exe'),
    cli: join(home, 'resources', 'app.asar', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-desktop-host', 'lib', 'cli.js'),
  }
}

/** 起一个只回 success 的服务器。 */
export function mockServer(options = {}) {
  return startMockLlmServer({
    sequence: options.sequence || ['success'],
    successText: options.successText || '好。',
    repeatLast: true,
    ...(options.toolName ? { toolName: options.toolName } : {}),
    ...(options.toolArguments ? { toolArguments: options.toolArguments } : {}),
  })
}

/** 跑一次 headless；server 可由调用方共享，便于跨轮比较请求。 */
export function runHeadless({ server, dshHome, cwd, patch, task, extraArgs = [], env = {}, timeoutMs = 120_000 }) {
  const { exe, cli } = appPaths()
  return new Promise((resolve, reject) => {
    const baseUrl = server ? `${server.baseURL}/v1` : undefined
    const child = spawn(exe, [
      '--expose-internals', cli, '--profile', 'headless',
      ...(patch ? ['--patch', patch] : []),
      ...extraArgs,
      task,
    ], {
      cwd,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: dshHome,
        ...(baseUrl ? { DEEPSEEK_BASE_URL: baseUrl, DEEPSEEK_API_KEY: 'mock-key' } : {}),
        ...env,
      },
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => { stdout += d })
    child.stderr.on('data', (d) => { stderr += d })
    const started = Date.now()
    const timer = setTimeout(() => { child.kill(); reject(new Error(`timeout\n${stderr.slice(-2000)}`)) }, timeoutMs)
    child.on('error', reject)
    child.on('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr, ms: Date.now() - started, requests: server ? server.requests : [] })
    })
  })
}

/** 写一个只插入本插件的 patch 文件。 */
export function writePatch(file, repoPath, { pluginPath = PLUGIN_ENTRY, extraConfig = {} } = {}) {
  const lines = [
    '- insert:',
    '    - id: plain-memory',
    `      name: '${pluginPath.replaceAll('\\', '/')}'`,
    '      config:',
    `        repoPath: '${repoPath.replaceAll('\\', '/')}'`,
  ]
  for (const [k, v] of Object.entries(extraConfig)) lines.push(`        ${k}: ${JSON.stringify(v)}`)
  return lines.join('\n') + '\n'
}
