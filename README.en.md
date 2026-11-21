# dsh-plain-memory

[![npm version](https://img.shields.io/npm/v/dsh-plain-memory.svg)](https://www.npmjs.com/package/dsh-plain-memory)
[![license](https://img.shields.io/npm/l/dsh-plain-memory.svg)](LICENSE)

[中文](README.md) | English

## Install in three steps

1. DSH 0.2.2-rc.1 or newer (the version is shown at the bottom of Settings).
2. **Install**: Settings → Plugins → search for `dsh-plain-memory` → Install. Or one command: `dsh plugin add dsh-plain-memory`
3. **Restart DSH.** The first write asks for a memory-repo directory (any Git repo path you own, e.g. `C:/Users/you/memory-repo`); if you skip it, the plugin creates a minimal skeleton at `repoPath`.

After that: a fresh window starts with your long-term preferences already loaded (a managed block in `AGENTS.md`), and asking "what did we do last time" / "where did the other window get to" makes the model call `memory_recall`. **Auto-recall ships off** (`autoRecall: true` turns it on; why, below).

### Version note

**Use 1.1.3 or newer.** 1.1.2 shipped a UTF-8 BOM in `package.json`, so DSH reports the package as unavailable and never loads the plugin; 1.1.2 is deprecated on npm. 1.1.3 fixes it and adds a regression test (the manifest must not start with U+FEFF).

Plain memory for DeepSeek Harness. **Remove it and DSH is unchanged; install it and DSH keeps what you told it, and can look it up when asked.**

Memory is plain Markdown in your own Git repository. The plugin is 1,423 lines (blank lines included), imports only Node built-ins, calls no model, and runs no periodic timer.

## What it does

Three things, nothing more:

1. **Asset** — memory lives as Markdown in your own repo; the plugin pulls at session start, commits each write immediately, and pushes in a detached process.
2. **Query** — four tools; `memory_recall` reads memory by keyword. This is the default path: **nothing is injected on any turn.** The model calls it when the user refers to earlier work, another window, "last time", or "before".
3. **Optional auto-recall** — set `autoRecall: true` and each turn matches the user message locally (BM25 over Chinese bigrams plus a small hand-written concept bridge), injecting at most three entries above threshold. **Off by default; why, below.**

**Experimental: multi-window status cards (off by default, `cards: true`)** — sessions exchange a short delta when their cues match. Off by default because a stale card from an already-closed window was observed being pushed back.

## Measured properties

| Property | Value |
|---|---|
| Plugin source | **1,423 lines** including blank lines (excluding tests) |
| Runtime dependencies | **0** |
| Model calls inside the plugin | **0** |
| Periodic timers / resident processes | **0** |
| Fixed per-session injection | **≈487 tokens** (four tool schemas; measured on 1.0.1, schema unchanged since) |
| Injection per turn by default | **0 entries** (`autoRecall` is off) |
| Injection when nothing matches | **zero** |
| One recalled entry (only with `autoRecall`) | **≈124 tokens** |
| Uninstall | DSH boots normally; the memory repo is untouched byte for byte |

Measured against a real `headless` profile with a scripted mock model server, from the actual `/v1/messages` request bodies. See `test/e2e/measure.mjs`. Token counts are estimates, not a provider tokenizer.

## Verification

- **Prompt cache**: over three consecutive turns in one session, turn 2's message array is a byte-identical prefix of turn 3's; injection only appends.
- **Git does not block**: with an unreachable remote the turn takes 3,051 ms vs 2,989 ms baseline (−62 ms); push runs in a detached child.
- **Concurrency**: two processes writing ten entries each land 20/20, one commit, clean tree.

### Auto-recall, when you enable it

Offline replay over 40 days of real queries: injected items 192 → 24, zero-injection turns 29% → 87%, one repeated deadline entry 15 hits → 1. Then 20 injected memories were hand-labelled: **precision 7/20**. At that precision a default-on injection is a net negative, which is why it ships off.

With auto-recall on, the cross-domain probe (5 "experience in one vocabulary, ask in another" pairs) hit 5/5 with 0 false recalls on 6 unrelated questions — but the probes and the concept bridge share an author, so this is **not** independent validation, and that run used the older `minCues=1` default (2 since 1.1.0).

## Install

```sh
dsh plugin --profile desktop add <path-or-git-url>
```

Then add one row to the profile's `cordis.patch.yml`:

```yaml
- insert:
    - id: plain-memory
      name: 'dsh-plain-memory'
      config:
        repoPath: 'C:/Users/you/memory-repo'
```

Restart DSH. **Rollback**: delete that row, `dsh plugin --profile desktop remove dsh-plain-memory`, restart.

## Self layer

`self.md` is mirrored into a managed block inside `$DSH_HOME/AGENTS.md`, so identity and preferences are present from the first turn. Only the marked block is touched. A preference the user explicitly asked to remember is written directly; a preference the model inferred becomes a proposal until the user confirms it.

## Limits

- The concept bridge is a hand-written word list (23 groups, capped at 50), not a semantic model.
- Status cards only travel between sessions on the same Git branch or sharing changed files.
- Consolidation is optional and manual: paste `prompts/daily-consolidate.md` into a normal session when you want it. No scheduler, no timers.
- Chinese is tokenised into character bigrams; no dictionary or segmenter.

## Tools

`memory_write`, `memory_confirm`, `memory_card`, `memory_recall`.

## License

MIT


