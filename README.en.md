# dsh-plain-memory

[![npm version](https://img.shields.io/npm/v/dsh-plain-memory.svg)](https://www.npmjs.com/package/dsh-plain-memory)
[![license](https://img.shields.io/npm/l/dsh-plain-memory.svg)](LICENSE)

[中文](README.md) | English

Plain memory for DeepSeek Harness. **Remove it and DSH is unchanged; install it and DSH remembers you and recalls what matters.**

Memory is plain Markdown in your own Git repository. The plugin is 1,141 lines, imports only Node built-ins, calls no model, and runs no periodic timer.

## What it does

1. **Asset** — memory lives as Markdown in your private repo; the plugin pulls at session start, commits each write immediately, and pushes in a detached process.
2. **Multiple windows (experimental, off by default)** — enable with `cards: true`; sessions then exchange a short delta when their cues match. Off by default because a stale card from an already-closed window was observed being pushed back.
3. **Recall** — each memory carries cue words; every turn matches the user message locally (BM25 over Chinese bigrams plus a small hand-written concept bridge) and injects at most three entries, only above threshold.

## Measured properties

| Property | Value |
|---|---|
| Plugin source | **1,045 lines** (excluding tests) |
| Runtime dependencies | **0** |
| Model calls inside the plugin | **0** |
| Periodic timers / resident processes | **0** |
| Fixed per-session injection | **≈596 tokens** (four tool schemas) |
| Injection when nothing matches | **zero** |
| One recalled entry | **≈124 tokens** |
| Uninstall | DSH boots normally; the memory repo is untouched byte for byte |

Measured against a real `headless` profile with a scripted mock model server, from the actual `/v1/messages` request bodies. See `test/e2e/measure.mjs`. Token counts are estimates, not a provider tokenizer.

## Verification

- **Prompt cache**: over three consecutive turns in one session, turn 2's message array is a byte-identical prefix of turn 3's; injection only appends.
- **Cross-domain recall**: 5/5 probes hit, 0 false recalls on 6 unrelated questions — note that probes and concept bridge share an author, so this is not independent validation.
- **Git does not block**: with an unreachable remote the turn takes 3,051 ms vs 2,989 ms baseline (−62 ms); push runs in a detached child.
- **Concurrency**: two processes writing ten entries each land 20/20, one commit, clean tree.

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
- Consolidation is a DSH `schedule` task you create yourself; the plugin has no background logic.
- Chinese is tokenised into character bigrams; no dictionary or segmenter.

## Tools

`memory_write`, `memory_confirm`, `memory_card`, `memory_recall`.

## License

MIT
