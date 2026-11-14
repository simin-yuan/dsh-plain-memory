# dsh-plain-memory · 原味记忆

[English](README.en.md) | 中文

DSH 原生的轻记忆。**拔掉它，DSH 一点没变；装上它，DSH 记得你、需要时想得起来。**

记忆是纯 Markdown，放在你自己的 Git 仓库里。插件本体 1,141 行，只 import Node 内置模块，不调用任何模型，不起任何周期定时器。插件页显示名为「原味记忆」（`locale/zh.json`），包名与仓库名仍是 `dsh-plain-memory`。

## 为什么又做一个记忆插件

我读过主流的一批 DSH 记忆插件（只读、未安装）。它们大多在往「更重」的方向走：几万行代码、内置模型调用、后台巩固、SQLite 或向量库。而这里做的是**减法**——留两件核心事，外加一个实验功能，其余全部留给 DSH 自己：

1. **资产**：记忆是纯 Markdown，存在你自己的 Git 仓库；会话开头自动 pull，写入当场提交，推送在后台，不挡对话。
2. **唤起**：写记忆时顺手写线索词；之后用用户消息在本地做 BM25 匹配，命中才注入。

**实验功能：多窗口状态卡（默认关闭，`cards: true` 才开）**——每个会话写一张状态卡，别的窗口用同一套线索匹配去查，过阈值才推 1–2 行增量。卡 24 小时过期。已知问题见「边界」，默认不开。

## 硬指标（实测，非估算）

| 指标 | 实测 |
|---|---|
| 插件源码 | **1,141 行**（`index.js` 634 + `memory.js` 347 + `git.js` 101 + `cards.js` 59，不含测试）；统计命令见文末 |
| 运行时依赖 | **0**（只 import `node:fs` / `node:path` / `node:os` / `node:crypto` / `node:child_process` / `node:url`） |
| 插件内模型调用 | **0**（全仓无 LLM 客户端、无 `fetch`、无 API 调用） |
| 周期定时器 / 常驻进程 | **0**（只有 `index.lock` 退避时的一次性 sleep；push 是分离子进程，不是常驻） |
| 每会话固定注入 | **≈487 token**（4 个工具 schema，约为单轮请求的 2.8%） |
| 自我层 | 取决于你自己的条目：实测 4 条约 347 token（约 2.0%） |
| 无相关内容时 | **零注入**（空记忆仓、无窗口更新时，请求体里没有任何注入消息） |
| 单次召回注入 | 1 条实测 **≈124 token**；上限 3 条，整块裁剪到 700 token 以内 |
| 卸载 | 去掉 patch 后正常启动，记忆仓一个字节不变 |

测量方法：真 DSH `headless` profile + 真 agent loop + 脚本化的假模型服务器（零 token 成本），从实际发出的 `/v1/messages` 请求体里量。见 `test/e2e/measure.mjs`。token 数是估算（中文按 1 字 1 token、ASCII 按 4 字符 1 token），不是提供方分词器。

## 四项验证

| 验证 | 结果 |
|---|---|
| **提示缓存**：同一会话连续 3 轮，比较请求里的消息数组 | 第二轮 3 条是第三轮 5 条的**逐字节前缀**；注入只追加在末尾，历史一条不改 |
| **跨领域唤起**：5 组「经历一套词、提问另一套词」 | **5/5 命中**，6 条无关提问**误召回 0**。注意：用例与概念桥是同一作者写的，这**不是**独立验证 |
| **git 卡死**：远端指向不可达地址（TEST-NET-1） | 基线 3,051 ms / 不可达远端 2,989 ms（差 −62 ms）；回合照常结束，push 不挡对话 |
| **并发写入**：两个进程同时各写 10 条 | **20/20 落盘**，无报错，1 个提交覆盖两边，工作区干净 |

命令：`node test/e2e/cache.mjs`、`cross-domain.mjs`、`git-block.mjs`、`concurrency.mjs`（前两个需要 `DSH_APP_HOME`）。

## 它怎么工作

**注入方式**：每轮只往消息末尾**追加**一条 user message（`agent/pre-step` 瀑布），不改 system prompt、不改历史前缀，所以提供方的提示缓存不整段失效。非首步不重复注入；没命中就什么都不加；同一条记忆在同一窗口只注入一次。

**自我层**：`self.md` 的内容同步进 `$DSH_HOME/AGENTS.md` 里一段带标记的托管块，DSH 原生在每个会话开始加载它，所以「你是谁、你的偏好」开局就在，不需要先命中一次。托管块只改标记之间那一段，`AGENTS.md` 里你自己的内容不会被碰。

**多窗口（实验性，默认关闭，`cards: true` 才开）**：每个会话写一张状态卡（工作线、改过的文件、本轮首句目标）。别的窗口**用和召回记忆同一套线索匹配**去查这些卡：本轮消息按句切分，逐句和卡的目标/结论/文件名比，**过阈值（默认 0.3）才注入** 1–2 行增量；同分支、同文件只是 +0.15 的加分项。同一张卡在同一窗口只出现一次，内容变了才再推送；**24 小时没更新的卡直接过期**。改到同一批文件是硬碰撞，仍会无条件提醒一次；目标几乎就是本轮这句话的「回声卡」不推。

> 为什么默认关闭：2026-11-14 的真机实测里，B 窗口问「另一个窗口的报价说明写到哪了？」，实际收到的是**上一次测试遗留的同句卡片**（回声），而不是 A 窗口的工作卡——A 的卡对这句话只重合「报价说明」一个概念，分数不够。回声过滤能挡住逐字重复，挡不住「已关闭窗口留下的过时卡」。「不打扰」是最核心的承诺，所以这一项默认不开。

**跨领域唤起**：写记忆时写 `cues`（线索词），会话结束或每日巩固时把它们写得更抽象。之后每轮用用户消息做本地匹配：中文二元组 + 23 组手写概念桥（评委/评审、转圈/卡住、换电脑/迁移）+ 停用词，0–1 归一分，默认阈值 0.3。长消息按句切开分别召回，避免十个问题挤一条时被稀释。

**git 不挡对话**：拉取最多 5 秒、提交最多 5 秒、撞上另一个窗口的 `index.lock` 退避重试 3 次；写完记忆**当场提交**，推送在分离子进程里跑，回合不等它；失败只记日志，改动留在工作区，下次会话开头补交补推。所有 git 调用带 `GIT_TERMINAL_PROMPT=0`，不会弹凭证窗口。

**自检**：如果注入被宿主拒绝，或 `agent/pre-step` 一次都没触发，插件会在控制台、logger 和 `.state/health.log` 各留一条告警，不静默失效。

**巩固不在插件里**：合并重复、解决冲突、遗忘过时、提炼线索词，交给 DSH 原生的 `schedule` 每天跑一次**普通会话**，提示词见 [`prompts/daily-consolidate.md`](prompts/daily-consolidate.md)。提示词开头有闸门：没有新增情景记忆就直接结束，不做任何 git 操作。

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
```

重启 DSH。插件会在 `repoPath` 不存在时创建最小骨架（`README.md` + `self.md`），但**不会**替你建仓库或加远端。

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

## 接每日巩固

把 [`prompts/daily-consolidate.md`](prompts/daily-consolidate.md) 作为 DSH `schedule` 任务的提示词，每天清晨跑一次。它跑在普通会话里，插件不参与任何巩固代码。代价：新领悟要到第二天才进入索引。

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
- **一条记忆默认一个线索就算命中，可以调到两个。** 把 `minCues` 设成 2 会明显更安静（单个泛词触发不了），但实测会把跨领域召回从 5/5 压到 2/5；要开它，先靠巩固把线索词写扎实。
- **「记住」的判定偏宽**：消息里出现「记住 / 记下 / 以后都 / 以后不要 / 别再」就当作已确认，直接写自我层。
- **概念桥是手写词表，覆盖有限**：比如「电脑 / 笔记本」这一组就没收，这类漏召回时模型可以自己调 `memory_recall` 补查。
- **巩固要你自己建定时任务。** 插件里没有任何后台逻辑。
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
