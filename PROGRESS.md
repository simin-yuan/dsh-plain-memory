# 进度快照 · 2026-11-18

> **English abstract** — `dsh-plain-memory` v1.0.1 is public on GitHub and npm. All mechanisms run (Markdown memory in a user-owned Git repo, self-layer block in `AGENTS.md`, local cue-word recall, turn-end commits). Cross-window recall is empirically confirmed. **Recall precision has never been measured**: a 40-day / 171-event production log shows heavy noise (top 5 entries = 61.6% of all injected items; one short entry was injected 70 times with zero lexical overlap with those queries). Known defects and a measurement plan are below.

这一页是给"第一次读这个仓库的人/模型"用的全貌快照：状态、架构、**实测数据**、已知缺陷、下一步。细节读 `README.md`，版本变更读 `CHANGELOG.md`。

---

## 1. 一句话状态

机制全部在跑，跨窗口与自我层**已验证**；**"自动召回"的精度从未被量化**，现有生产日志显示噪声显著。代码自 2026-11-14 起冻结，之后只有文档改动。

## 2. 仓库与发布

| 项 | 状态 |
|---|---|
| 代码仓 | `github.com/simin-yuan/dsh-plain-memory`（public，默认分支 `main`） |
| npm | `dsh-plain-memory@1.0.1`（2026-11-14 发布） |
| 版本 | 1.0.1（`package.json`）；0.x 为开发期版本，未发布 |
| 代码冻结 | 1.0.1 之后未改代码（截至 2026-11-18，4 天） |
| 测试 | `node --test test/*.test.mjs` 3 个文件全过；`test/e2e/` 为真 DSH + 假模型服务器的实测脚本 |
| 规模 | `index.js` 686 行、`memory.js` 396 行、`git.js` 119 行、`cards.js` 69 行（含注释与空行），零运行时依赖 |

## 3. 架构（三分钟版）

- **记忆 = 纯 Markdown**，三层 `self/` `episodic/` `semantic/`，一条记忆一个文件，放使用者自己的 Git 仓库（不在本仓）。
- **四个工具**：`memory_write`、`memory_confirm`、`memory_card`、`memory_recall`。
- **注入两处**：① `self` 层渲染成 `$DSH_HOME/AGENTS.md` 里的托管块，会话开局即加载；② 每轮用线索词在本地打分召回，最多 3 条，追加在消息末尾（历史一条不改，保护提示缓存）。
- **零模型调用、零周期定时器**；git 提交在回合末用分离子进程，不挡对话。

## 4. 已验证（有数据支撑）

| 能力 | 证据 |
|---|---|
| 跨窗口传递 | 40 天日志：171 次召回事件、93 个不同窗口，其中 91 个窗口至少命中 1 条；存在"窗口 A 写入 → 59 分钟后窗口 B 召回"的实例 |
| 记忆落盘 | 同一记忆仓 40 次提交，无写入丢失；3 个回归测试覆盖并发写、托管块、召回 |
| 自我层开局可见 | 新会话的首条系统消息里已含托管块内容（非召回、不占召回名额） |
| 提示缓存友好 | 注入只追加在末尾，第二轮消息数组是第三轮的逐字节前缀 |
| 卸载可逆 | 删除 profile 里 `plain-memory` 一行即可，记忆仓字节不变；包文件消失时才清托管块 |

## 5. 未验证 / 现有证据偏负

统计口径：**1 个使用者、40 天、171 次召回事件、349 条被注入记忆**（数据来自使用者的私有记忆仓 `.state/recall.log`，不在本仓；统计时间 2026-11-18）。

| 观察 | 数字 |
|---|---|
| 注入高度集中 | 被注入的 349 条里，**前 5 条占 61.6%** |
| 单条噪声 | 某条短记忆被注入 **70 次（20.1%）**、其中 **38 次排第一**；而这 70 次提问里包含该条线索词的：**0 次** |
| 每轮注入量 | 命中事件平均 2.31 条；top-1 分数均值 0.562（0.226–0.866） |
| 相关性标注 | `relevant` 字段 171/171 全为 `null`——**没有任何人工相关性标注，precision/recall 无权威数字** |
| 概念桥 | 关联跳转（`hop`）只在 9/171 次（5.3%）触发 |
| 重复注入 | "同一记忆每窗口只注入一次"实测有 32/349（9.2%）重复 |
| 巩固/提炼 | 只有 `prompts/daily-consolidate.md` 的人工提示词，**无自动触发机制**；只剩一个时间戳文件 |
| README 里的"跨领域 5/5、误召回 0" | 是 6 条构造查询的微测（且用例与概念桥同一作者），不是生产数据 |

## 6. 已知缺陷（可直接改，按影响排序）

- **B1 自我层静默截断**：`SELF_TOKEN_BUDGET = 400`，超预算即 `break`（`index.js:83-96`），按文件顺序取前几条 → **最新写的规则最先被丢**，且无任何提示。实测 6 条规则只有 4 条进 `AGENTS.md`。修法：按日期新→旧排序 + 超预算显式告警（或提到 800 token）。
- **B2 相关性从不落值**：`relevant: null` 写死（`index.js:355`），注释写"由人补"，40 天无人补。修法：召回时用查询与条目的词面重合率自评 0/1 落盘，零成本。
- **B3 打分偏向短条目**：分数 = 命中权重 / 条目总权重（`acc/total`），短条目+几个泛词就能拿高分；默认阈值 0.3（`memory.js:259`、`memory.js:322`）。这与 B1 之外的"注入噪声"是同一根因。
- **B4 去重只在进程内**：`seenMem` 是内存 Set（`index.js:228`、`index.js:315`），进程重启或会话恢复后失效，导致 9.2% 重复注入。修法：落盘到记忆仓 `.state/`，或在注入前比对会话已有内容。
- **B5 概念桥低效**：23 组手写词表，实跑触发 5.3%。说明瓶颈在 `cues` 写法而非词表规模；继续堆词表不会改善。

## 7. 下一步（建议，尚未实施）

| 优先级 | 事项 | 验收标准 |
|---|---|---|
| P0 | 修 B1 + B2 | 6/6 条自我规则进 AGENTS.md；`relevant` 有非空值 |
| P1 | 用 B2 的数据画出 precision@1 曲线（按分数分桶） | 有一个可复算的数字，而不是"感觉有用" |
| P2 | 若 precision@1 < 60%：默认注入从"每轮 3 条"改为"高分才注入（阈值上调）+ 其余靠 `memory_recall` 主动查" | 注入量下降，人工抽检相关率上升 |
| P3 | 日巩固：要么做成真机制，要么删掉提示词 | 不留半成品 |

**判断依据**：这个插件已经交付的一半是"跨窗口 + 自我层 + Git 纯文本记忆"，是可证、可审计的；没交付的一半是"自动想起"，目前做功为负（噪声 + 每轮几十到几百 token）。所以下一步的正确方向是**减噪 + 把效果变成数字**，不是加功能。

## 8. 复现

```bash
node --test test/core.test.mjs test/plugin.test.mjs test/selfblock.test.mjs   # 回归
node test/e2e/cache.mjs        # 提示缓存（需 DSH_APP_HOME）
node test/e2e/cross-domain.mjs # 跨领域唤起（需 DSH_APP_HOME）
node test/e2e/git-block.mjs    # git 不挡回合
node test/e2e/concurrency.mjs  # 并发写入
```

本文第 5 节数字的算法：读召回日志（JSONL，每条含 `session`、`q`、`ids`、`titles`、`scores`、`hop`、`relevant`），按 `ids` 计频、按首元素计 top-1、按 `(session, id)` 计重复。日志格式见 `index.js:343-356`。
