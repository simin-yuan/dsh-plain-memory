# dsh-plain-memory · 原味记忆

[![npm version](https://img.shields.io/npm/v/dsh-plain-memory.svg)](https://www.npmjs.com/package/dsh-plain-memory)
[![license](https://img.shields.io/npm/l/dsh-plain-memory.svg)](LICENSE)

[English](README.en.md) | 中文

DSH 原生的轻记忆。**拔掉它，DSH 一点没变；装上它，DSH 记得你、需要时想得起来。**

记忆是纯 Markdown，放在你自己的 Git 仓库里。插件本体 1,423 行（含空行；`index.js` 819 + `memory.js` 418 + `git.js` 120 + `cards.js` 70），只 import Node 内置模块，不调用任何模型，不起任何周期定时器。插件页显示名为「原味记忆」（`locale/zh.json`），包名与仓库名仍是 `dsh-plain-memory`。

当前进度、生产实测数据与已知缺陷见 [PROGRESS.md](PROGRESS.md)（2026-11-18 快照）。

**反馈入口**：[GitHub Issues](https://github.com/simin-yuan/dsh-plain-memory/issues) — 装上遇到问题、或者觉得某条记忆该被想起却没想起，都直接开 issue，附上提问原文和当时的上下文。

## 这里只做三件事

其余全部留给 DSH 自己：

1. **资产**：记忆是纯 Markdown，存在你自己的 Git 仓库；会话开头自动 pull，写入当场提交，推送在后台，不挡对话。
2. **查询**：四个工具，其中 `memory_recall` 按关键词读记忆全文——用户提到以前的工作、其他窗口、「上次」「之前」时，模型先调它。**这是默认的记忆入口，每轮不注入任何东西。**
3. **自动注入（可选，默认关闭）**：配 `autoRecall: true` 打开，按线索词在本地匹配，最多 3 条追加在消息末尾。为什么默认关，见「自动注入默认关闭」一节。

**实验功能：多窗口状态卡（默认关闭，`cards: true` 才开）**——每个会话写一张状态卡，别的窗口用同一套线索匹配去查，过阈值才推 1–2 行增量。卡 24 小时过期。已知问题见「边界」，默认不开。

## 硬指标（实测，非估算）

| 指标 | 实测 |
|---|---|
| 插件源码 | **1,423 行**（含空行：`index.js` 819 + `memory.js` 418 + `git.js` 120 + `cards.js` 70，不含测试）；统计命令见文末 |
| 运行时依赖 | **0**（只 import `node:fs` / `node:path` / `node:os` / `node:crypto` / `node:child_process` / `node:url`） |
| 插件内模型调用 | **0**（全仓无 LLM 客户端、无 `fetch`、无 API 调用） |
| 周期定时器 / 常驻进程 | **0**（只有 `index.lock` 退避时的一次性 sleep；push 是分离子进程，不是常驻） |
| 每会话固定注入 | **≈487 token**（4 个工具 schema；1.0.1 实测，之后工具 schema 未变） |
| 默认每轮注入 | **0 条**（`autoRecall` 默认关；开着也只在命中时注入） |
| 自我层 | 取决于条目；写入时按 400 token 把关，超过拒绝写入并提示合并 |
| 无相关内容时 | **零注入**（空记忆仓、无窗口更新时，请求体里没有任何注入消息） |
| 单次召回注入（仅在打开 `autoRecall` 后） | 1 条实测 **≈124 token**；上限 3 条，整块裁剪到 700 token 以内 |
| 卸载 | 去掉 patch 后正常启动，记忆仓一个字节不变 |

测量方法：真 DSH `headless` profile + 真 agent loop + 脚本化的假模型服务器（零 token 成本），从实际发出的 `/v1/messages` 请求体里量。见 `test/e2e/measure.mjs`。token 数是估算（中文按 1 字 1 token、ASCII 按 4 字符 1 token），不是提供方分词器。

## 两项验证（与注入无关的那两项）

| 验证 | 结果 |
|---|---|
| **提示缓存**：同一会话连续 3 轮，比较请求里的消息数组 | 第二轮 3 条是第三轮 5 条的**逐字节前缀**；注入只追加在末尾，历史一条不改 |
| **git 卡死**：远端指向不可达地址（TEST-NET-1） | 基线 3,051 ms / 不可达远端 2,989 ms（差 −62 ms）；回合照常结束，push 不挡对话 |
| **并发写入**：两个进程同时各写 10 条 | **20/20 落盘**，无报错，1 个提交覆盖两边，工作区干净 |

命令：`node test/e2e/cache.mjs`、`git-block.mjs`、`concurrency.mjs`（第一个需要 `DSH_APP_HOME`）。跨领域唤起那一组实测见「自动注入默认关闭」。

## 它怎么工作

**注入方式**（1.1.2 起默认关闭，见「自动注入默认关闭」）：每轮只往消息末尾**追加**一条 user message（`agent/pre-step` 瀑布），不改 system prompt、不改历史前缀，所以提供方的提示缓存不整段失效。非首步不重复注入；没命中就什么都不加；同一条记忆在同一窗口只注入一次。

**自我层**：`self.md` 的内容同步进 `$DSH_HOME/AGENTS.md` 里一段带标记的托管块，DSH 原生在每个会话开始加载它，所以「你是谁、你的偏好」开局就在，不需要先命中一次。托管块只改标记之间那一段，`AGENTS.md` 里你自己的内容不会被碰。

**多窗口（实验性，默认关闭，`cards: true` 才开）**：每个会话写一张状态卡（工作线、改过的文件、本轮首句目标）。别的窗口**用和召回记忆同一套线索匹配**去查这些卡：本轮消息按句切分，逐句和卡的目标/结论/文件名比，**过阈值（默认 0.3）才注入** 1–2 行增量；同分支、同文件只是 +0.15 的加分项。同一张卡在同一窗口只出现一次，内容变了才再推送；**24 小时没更新的卡直接过期**。改到同一批文件是硬碰撞，仍会无条件提醒一次；目标几乎就是本轮这句话的「回声卡」不推。

> 为什么默认关闭：2026-11-14 的真机实测里，B 窗口问「另一个窗口的报价说明写到哪了？」，实际收到的是**上一次测试遗留的同句卡片**（回声），而不是 A 窗口的工作卡——A 的卡对这句话只重合「报价说明」一个概念，分数不够。回声过滤能挡住逐字重复，挡不住「已关闭窗口留下的过时卡」。「不打扰」是最核心的承诺，所以这一项默认不开。

**跨领域唤起（仅在打开 `autoRecall` 后）**：写记忆时写 `cues`（线索词），巩固时把它们写得更抽象。打开后每轮用用户消息做本地匹配：中文二元组 + 停用词，0–1 归一分，默认阈值 0.3，且**至少要 2 个独立线索**（`minCues` 默认 2）。自动注入**不按句切开**——切句会让「三个字的一段刚好碰上一个词」拿到接近 1.0 的分，是噪声的主要来源；按句切分只留给主动查询 `memory_recall`。23 组手写概念桥（评委/评审、转圈/卡住）也只在主动查询里生效。

**日期会过期**：记忆可以带 `- expires: YYYY-MM-DD`。只有带明确截止日期的事（截止/交稿/deadline）才自动填，观察日期（某天实测）不填。过期后整条不再参与召回，不用等人来清理。

**git 不挡对话**：拉取最多 5 秒、提交最多 5 秒、撞上另一个窗口的 `index.lock` 退避重试 3 次；写完记忆**当场提交**，推送在分离子进程里跑，回合不等它；失败只记日志，改动留在工作区，下次会话开头补交补推。所有 git 调用带 `GIT_TERMINAL_PROMPT=0`，不会弹凭证窗口。

**自检**：如果注入被宿主拒绝，或 `agent/pre-step` 一次都没触发，插件会在控制台、logger 和 `.state/health.log` 各留一条告警，不静默失效。

**巩固不在插件里，而且默认不做**：合并重复、解决冲突、提炼线索词，都是「你想做的时候手动跑一次」的普通会话，提示词见 [`prompts/daily-consolidate.md`](prompts/daily-consolidate.md)。插件不建任何定时任务：靠定时弹窗打断使用，按设计品味是负价值；到期的记忆交给 `expires`。

## 安装

```sh
dsh plugin --profile desktop add <本仓库路径或 git URL>
```

然后在 profile 的 `cordis.patch.yml` 加一行（或依赖包自带的 `cordis.patch.yml` 自动插入）：

```yaml
- insert:
    - id: plain-memory
      name: 'dsh-plain-memory'
      config:
        repoPath: 'C:/Users/you/memory-repo'   # 你的记忆仓本地 clone
        # autoRecall: true                      # 想开自动注入再加这一行（默认关闭，原因见下）
```

重启 DSH。插件会在 `repoPath` 不存在时创建最小骨架（`README.md` + `self.md`），但**不会**替你建仓库或加远端。

### 自动注入默认关闭（1.1.2 起）

**默认 `autoRecall: false`：每轮不注入任何东西，记忆靠 `memory_recall` 主动查。** 自我层照常进 `AGENTS.md`，跨窗口共享照常。

为什么默认关：我们拿 40 天真实使用日志做过离线重放，把噪声压到原来的 1/8 之后，抽样 20 条"被注入的记忆"人工判，**注入精度是 7/20**（两条边界项按最宽算也只有 9/20）。这个精度下，"不用主动查"的便利是负价值——每 20 次注入里有 13 次是噪声，用户第一感觉会是"乱塞东西"。所以默认安静，把开关留给想要的人。

打开方式：上面 `config` 里加 `autoRecall: true`。打开后每轮按线索词召回最多 `maxRecall`（默认 3）条，追加在消息末尾，不改历史。

重放数据（同一批 173 条真实提问）：注入 192 → 24 条，零注入轮次 29% → 87%，某条过期截止日记忆 15 → 1 次。

开回自动注入之后，跨领域唤起那组用例（5 组「经历一套词、提问另一套词」）是 **5/5 命中、6 条无关提问 0 误召回**——但注意：用例与概念桥同一个作者写的，**不是**独立验证；且那组实测跑在 `minCues=1` 的旧默认下（1.1.0 起默认 2）。

## 记忆仓

**回滚**：从 `cordis.patch.yml` 删掉 `id: plain-memory` 那一行，再 `dsh plugin --profile desktop remove dsh-plain-memory`，重启。记忆仓保留，DSH 行为与装之前完全一致。

## 记忆仓

```sh
mkdir my-memory && cd my-memory && git init
git remote add origin <你的私有仓库>
```

目录与格式见 [`template/README.md`](template/README.md)。三层：

- `self.md` 自我层——身份、偏好、长期约束。用户亲口说「记住」时直接写入；模型自己推断的偏好只生成待确认提案，用户同意后才写。
- `episodic/<日期>-<标题>-<短id>.md` 情景层——哪天做了什么、结论是什么。
- `semantic/<日期>-<标题>-<短id>.md` 语义层——跨会话可复用的事实与方法。
- `.state/` 运行时（状态卡、观察日志、待确认提案），被 gitignore。

一条记忆一个文件，两个窗口同时写不同记忆不会互相覆盖。

## 接巩固（可选、手动）

想把这段记忆仓整理一遍时，把 [`prompts/daily-consolidate.md`](prompts/daily-consolidate.md) 的内容贴给 DSH 跑一次就行，不需要建任何定时任务。不跑也能用：`cues` 写得好就够召回，过期的条目由 `expires` 自动退出。

## 工具

| 工具 | 作用 |
|---|---|
| `memory_write` | 写一条记忆（semantic / episodic / self） |
| `memory_confirm` | 用户确认后，把自我层提案写入 `self.md` |
| `memory_card` | 更新本窗口状态卡：目标、结论、工作线 |
| `memory_recall` | 按关键词读取记忆全文（只读；注入被截断时用它） |

## 边界（诚实说明）

- **概念桥是手写词表，不是语义模型。** 23 组，上限 50 组；词表里没有的说法接不住。这是为了不引入向量模型、推理进程和下载。真需要更强的召回，应该改线索词的写法，或换掉整条检索路径。
- **多窗口默认关闭。** 打开后仍有两个已知问题：①目标几乎等于本轮消息的「回声卡」会被过滤，但**已关闭窗口留下的旧卡照样可能冒出来**；②A 的卡对 B 的问法可能分数不够（只重合一个概念）。要转正，得先测「没问也该知道」的场景。
- **默认要两个独立线索才算命中（`minCues` 默认 2）。** 只有一个泛词重合时不注入；概念桥 token（同义词折算）不算线索，否则「窗口/会话」这类词会把不相干的记忆拉进阈值。想更安静就把 `minCues` 调高，想更宽就调回 1——代价是噪声回来。
- **「记住」的判定偏宽**：消息里出现「记住 / 记下 / 以后都 / 以后不要 / 别再」就当作已确认，直接写自我层。
- **概念桥是手写词表，覆盖有限**：比如「电脑 / 笔记本」这一组就没收，这类漏召回时模型可以自己调 `memory_recall` 补查。
- **巩固要你自己手动跑。** 插件里没有任何后台逻辑和定时任务。
- **中文用二元组切词**，不引入词典或分词器。
- 检索阈值和条数可配（`minScore` 默认 0.3、`maxRecall` 默认 3），但默认值只在有限场景里调过。

## 测试

```sh
node test/core.test.mjs               # 记忆仓内核：解析、BM25、概念桥、一跳、写入
node test/plugin.test.mjs             # 插件装配：注入、卡片、自我层、去重、提交、重启恢复
node test/selfblock.test.mjs          # 自我层 → AGENTS.md 托管块
node test/e2e/cross-domain.mjs        # 5 组跨领域用例 + 6 条无关提问
DSH_APP_HOME=<DSH 安装目录> node test/e2e/run.mjs        # 真 DSH 端到端
DSH_APP_HOME=<DSH 安装目录> node test/e2e/measure.mjs    # 硬指标实测
DSH_APP_HOME=<DSH 安装目录> node test/e2e/cache.mjs      # 3 轮提示缓存前缀
DSH_APP_HOME=<DSH 安装目录> node test/e2e/git-block.mjs  # 不可达远端不挡回合
node test/e2e/concurrency.mjs         # 两进程并发写
```

端到端需要先在该目录 `npm install`（只装假模型服务器，和插件运行时无关）。

## 行数统计

```sh
node -e "const fs=require('fs');for(const f of ['index.js','memory.js','git.js','cards.js']){const t=fs.readFileSync(f,'utf8');console.log(f,'总行',t.split('\n').length,'非空行',t.split('\n').filter(l=>l.trim()).length)}"
```

## License

MIT


