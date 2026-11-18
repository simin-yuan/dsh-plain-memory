# 进度快照 · 2026-11-18

> **English abstract** — `dsh-plain-memory` v1.1.0 is public on GitHub and npm. Mechanisms all run: Markdown memory in a user-owned Git repo, self-layer block in `AGENTS.md`, local cue-word recall, turn-end commits. Cross-window recall is empirically confirmed. v1.1.0 is a noise-reduction release: on the same 173 real queries, offline replay drops auto-injection from 192 items to 24 and raises zero-injection turns from 50 to 151 (87%); one repeatedly mis-injected deadline entry drops from 15 hits to 1. **Recall precision is still not measured by anyone** — a 20-row sample table is attached for human labelling. Known limits and next steps below.

这一页是给"第一次读这个仓库的人/模型"用的全貌快照：状态、架构、**实测数据**、已知缺陷、下一步。细节读 `README.md`，版本变更读 `CHANGELOG.md`。

---

## 1. 一句话状态

机制全部在跑，跨窗口与自我层**已验证**；自动召回在 1.1.0 里做了减噪（注入量降 8 倍），**但精度仍没有人工标注**，剩下 24 条注入是不是对的，还没人判过。

## 2. 仓库与发布

| 项 | 状态 |
|---|---|
| 代码仓 | `github.com/simin-yuan/dsh-plain-memory`（public，默认分支 `main`） |
| npm | `dsh-plain-memory@1.1.0`（1.0.1 于 2026-11-14 发布，1.1.0 于 2026-11-18） |
| 测试 | 3 个 `node --test` 文件全过；`test/e2e/` 是"真 DSH + 假模型服务器"的实测脚本 |
| 离线重放 | `test/replay-compare.mjs`：拿真实使用日志当查询集，对比召回参数（见第 5 节） |
| 规模 | `index.js` 约 700 行、`memory.js` 约 430 行、`git.js` 119 行、`cards.js` 69 行（含注释），零运行时依赖 |

## 3. 架构（三分钟版）

- **记忆 = 纯 Markdown**，三层 `self/` `episodic/` `semantic/`，一条记忆一个文件，放使用者自己的 Git 仓库（不在本仓）。
- **四个工具**：`memory_write`、`memory_confirm`、`memory_card`、`memory_recall`。
- **注入两处**：① `self` 层渲染成 `$DSH_HOME/AGENTS.md` 的托管块，会话开局即加载；② 每轮用线索词在本地打分召回，最多 3 条，追加在消息末尾（历史一条不改，保护提示缓存）。
- **零模型调用、零定时器**；git 提交在回合末用分离子进程，不挡对话。巩固是**可选、手动**的提示词，不是后台任务。

## 4. 已验证（有数据支撑）

| 能力 | 证据 |
|---|---|
| 跨窗口传递 | 40 天日志：171 次召回事件、93 个窗口，其中 91 个窗口至少命中 1 条；有"窗口 A 写入 → 59 分钟后窗口 B 召回"的实例 |
| 记忆落盘 | 记忆仓 40 次提交，无写入丢失；测试覆盖并发写、托管块、召回 |
| 自我层开局可见 | 新会话首条系统消息里已含托管块（不占召回名额） |
| 提示缓存友好 | 注入只追加在末尾，第二轮消息数组是第三轮的逐字节前缀 |
| 卸载可逆 | 删除 profile 里 `plain-memory` 一行即可；包文件消失时才清托管块 |
| 过期即退出 | `expires` 过期条目在重放中 0 次召回（单测覆盖） |

## 5. 召回：1.0.x 的生产事实 vs 1.1.0 的重放结果

**生产事实（1.0.x，40 天，171 次召回事件、349 条注入）**：注入高度集中——前 5 条占 61.6%；某条短记忆被注入 70 次（20.1%），其中 38 次排第一，而这 70 次提问里包含其线索词的 **0 次**；`relevant` 字段 171/171 为 `null`（设计上由人补，40 天无人补）；概念桥关联跳转只触发 9 次（5.3%）；"同一记忆每窗口只注入一次"实测有 32/349（9.2%）重复。

**1.1.0 的离线重放（同一批 173 条真实提问、同一去重规则）**：

| 口径 | 注入条数 | 零注入轮次 | 零注入占比 | 前 5 条占比 | 那条截止日记忆 |
|---|---|---|---|---|---|
| 旧参数（按句切分 + 1 个线索 + 概念桥计线索） | 192 | 50 | 29% | 66.7% | 15 次 |
| 新参数（不切句 + 2 个线索 + 概念桥不计线索 + 过期跳过） | **24** | **151** | **87%** | 66.7% | **1 次** |

拆开来归因（同一批提问，只改一项）：只把线索数改成 2 → 79 条；只关掉按句切分 → 69 条；只让概念桥不计线索 → 179 条（条数几乎不变，但那条截止日记忆从 15 次降到 8 次）。两个开关叠起来才有 24 条。

**两个必须说明的口径问题**：① 日志里的提问当时被截断到 120 字，长语音转写被削掉尾部，所以重放绝对值（192）低于生产日志（349），**只有同一口径下的前后对比有效**；1.1.0 起日志记 600 字。② 重放用的索引按"提问当天已存在的记忆"切片，仍不是逐毫秒的真实索引。

## 6. 已知缺陷（1.1.0 之后的账）

已修：自我层显示时静默截断（改成写入时把关，超 400 token 拒绝写入）；召回按句切分带来的高分噪声；概念桥当线索用；去重依赖进程内状态；过期记忆反复召回。

仍在：

- **精度没有人工标注。** 减噪只证明"注入少了"，没证明"剩下的是对的"。已生成 20 行抽样表（提问 / 注入的条目 / 分数 / 命中词），等人判一次真/假；这张表含真实提问文本，不进公开仓。
- **残余噪声仍偏"通用词"。** 抽样里 0.30–0.34 分的命中，命中词多是「评论 / 仓库 / pr / 完整」这类泛词；阈值仍是 0.3，没上调。
- **前 5 条集中度没降**（66.7%）。条目少的时候 IDF 分不开常用词与关键词，这是结构性的，要更多外部数据才能判断。
- **单用户样本。** 34 条记忆、1 个使用者；在这个规模上调参数等于贴着一个人调，结论不能当"更好的记忆插件"的证据。
- **概念桥与按句切分只服务主动查询**，自动注入路径已不走它们；`memory_recall` 的行为未变。

## 7. 下一步（建议，尚未实施）

| 优先级 | 事项 | 验收标准 |
|---|---|---|
| P1 | 人工判 20 条抽样（10 分钟） | 得到一个 precision@1 的点估计 |
| P2 | 若 precision@1 < 60%：默认注入上限从 3 条降到 1 条，或把 `minScore` 从 0.3 上调 | 注入量继续下降，抽样相关率上升 |
| P3 | 找 2–3 个外部用户各用一周 | 不靠单用户日志也能说明效果 |

## 8. 复现

```bash
node --test test/core.test.mjs test/plugin.test.mjs test/selfblock.test.mjs   # 回归
node test/e2e/cache.mjs        # 提示缓存（需 DSH_APP_HOME）
node test/e2e/cross-domain.mjs # 跨领域唤起（需 DSH_APP_HOME）
node test/e2e/git-block.mjs    # git 不挡回合
node test/e2e/concurrency.mjs  # 并发写入

# 离线重放：旧参数 vs 新参数（<记忆仓> <日志> 指向使用者的私有记忆仓）
node test/replay-compare.mjs <repo> <recall.log> --split=1 --min=1 --hop=1 --concept=1 --out=old.json
node test/replay-compare.mjs <repo> <recall.log> --split=0 --min=2 --hop=0 --concept=0 --out=new.json --sample=20
```

日志是 JSONL：注入行含 `q ids titles scores hits hop cards relevant`；下一轮补一行 `used`（回答里是否出现该条正文 ≥2 个特征词）。统计口径：按 `ids` 计频、按首元素计 top-1、按 `(session, id)` 计重复。
