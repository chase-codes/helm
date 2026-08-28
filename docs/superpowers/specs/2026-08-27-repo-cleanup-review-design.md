# Repo cleanup review — design

Date: 2026-08-27
Status: approved

## Goal

A verified, non-breaking cleanup pass over `src/` (main, preload, renderer, shared) reviewing code quality, simplicity, performance, TS/React/Electron best practices, growth-readiness, and design-changeability (styling/theming separation). Output is individual GitHub issues that don't overlap, plus a batching file so a fixer agent can execute batches of issues together.

Not in scope: visual/design changes, site/, scratch/, docs/, build scripts/config.

## Phases

### Phase 1 — Fan-out review (read-only, parallel subagents)

Agents partitioned **by code area** (not by dimension) so findings are file-scoped and naturally non-overlapping. Each agent applies the same dimension checklist and returns structured findings (file:line, claim, why it matters, proposed fix, risk).

1. `src/main` — main process, IPC handlers, DB, updater, songSources, importSources
2. `src/renderer/operator` (split into 2 agents by subfolder)
3. `src/renderer/output` + `src/renderer/shared` + `src/preload`
4. `src/shared` — songs, scripture, search, message, preservice, hotkeys
5. Architecture cross-cutter — IPC contract shape, main/renderer boundaries, state flow, styling/theming separation, growth pain points

Off-limits for all agents: design/visual output changes; relaxing search ratchets or gold-guard tests; intentional behaviors documented in specs/notes (bm25 tie-break prior, scripture fit floor 1.5cqmin, hidden tape plays, pivot shift-click, cue-only live updates, manual-only rich upgrade states, EMPTY_EXTENT semantics, idf guard comments).

### Phase 2 — Verify + dedup

Findings merged and deduped; adversarial verifier agents re-read the actual code and try to refute each finding. Only findings confirmed real, behavior-preserving, and low-risk to fix survive (strict bar). Micro-findings in the same file are clustered into one issue.

### Phase 3 — File GHIs

One issue per surviving cluster: `cleanup` label + existing `area:*`; body lists exact files, what/why, acceptance criteria, and verification commands (`npm run typecheck`, `npm run lint`, `npm test`). No code changes in phases 1–3.

### Phase 4 — Batching file

`docs/cleanup-batches.md`: batches with disjoint file sets computed from the issues, suggested order, and a standing fixer-agent prompt — one branch + PR per batch, typecheck/lint/test green before claiming done, issues closed via PR.

## Safety

- Phases 1–3 are read-only apart from issue creation.
- Batches never share files, so batch PRs can't conflict.
- Every finding is verified against the code by a second agent before filing.
