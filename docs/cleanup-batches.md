# Cleanup batches — 2026-08 repo review

Source: verified review in `docs/superpowers/specs/2026-08-27-repo-cleanup-review-design.md`. Issues #126-#157, all labeled `cleanup`.

## How to run a batch

Give an agent the fixer prompt below plus one batch id. One branch + one PR per batch; the PR closes every issue in the batch (`Fixes #N` per issue).

**Concurrency rules**
- `parallel-ok` batches (B1-B5) touch disjoint files: any of them may run concurrently with each other and with the current sequential batch.
- `sequential` batches (B6-B10) share renderer files across batches: run them one at a time, in order, each branched from main after the previous batch's PR merges.
- B3 (sandbox) runs last overall and needs a manual smoke test.

**Fixer prompt (per batch)**

> Work through the issues in batch <ID> of docs/cleanup-batches.md together on one branch (`cleanup/<id>-<slug>`). Read every issue body first; where issues in the batch propose overlapping helpers, design the single shared shape before editing. Every fix must be behavior- and visual-preserving: computed styles, channels, payloads, and ranking results byte-identical unless the issue explicitly states the corrected output (e.g. #126, #147). Never relax ratchet or gold-guard tests; never run `prettier --write`. Follow TDD where an issue names a testable seam. Before the PR: `npm run typecheck && npm run lint && npm test` all green, and update each issue's acceptance criteria checklist in the PR description. Do not start work on files owned by another batch.

## Batches

### B1 — Main-process seams  (parallel-ok)

| Issue | Title | Files |
|---|---|---|
| [#126](https://github.com/chase-codes/helm/issues/126) | Fix hardcoded "Windows" OS label in Help > Report a Problem | `src/main/index.ts`, `src/main/feedback.ts`, `src/main/feedback.test.ts` |
| [#129](https://github.com/chase-codes/helm/issues/129) | Extract shared broadcastAll helper for all-windows fan-out | `src/main/broadcast.ts`, `src/main/index.ts`, `src/main/displays.ts`, `src/main/stateStore.ts`, `src/main/videoState.ts` |
| [#130](https://github.com/chase-codes/helm/issues/130) | Move biblesBookExtent version-resolution logic into biblesRepo | `src/main/ipc.ts`, `src/main/biblesRepo.ts`, `src/main/biblesRepo.test.ts` |
| [#131](https://github.com/chase-codes/helm/issues/131) | Collapse duplicated per-display setting flow in displays.ts | `src/main/displays.ts` |
| [#154](https://github.com/chase-codes/helm/issues/154) | Type-check IPC registrations and switch registerIpc to a deps object | `src/main/ipc.ts`, `src/main/index.ts`, `src/preload/index.ts`, `src/shared/types.ts` |

### B2 — Main-process perf & repos  (parallel-ok)

| Issue | Title | Files |
|---|---|---|
| [#127](https://github.com/chase-codes/helm/issues/127) | Copy picked media files asynchronously in mediaImport | `src/main/mediaImport.ts`, `src/main/mediaImport.test.ts` |
| [#128](https://github.com/chase-codes/helm/issues/128) | Prepare messagesRepo search statements once, not per keystroke | `src/main/messagesRepo.ts` |
| [#132](https://github.com/chase-codes/helm/issues/132) | Extract shared service_items store for schedule repos | `src/main/serviceItemsStore.ts`, `src/main/scheduleRepo.ts`, `src/main/messagesScheduleRepo.ts` |

### B3 — Chromium sandbox (medium risk)  (parallel-ok)

Run LAST. Behavioral surface: verify operator + output windows, video playback, and PDF import still work in a packaged build; manual smoke test required before merge.


| Issue | Title | Files |
|---|---|---|
| [#156](https://github.com/chase-codes/helm/issues/156) | Enable Chromium sandbox for operator and output windows | `src/main/index.ts`, `src/main/displays.ts` |

### B4 — Shared: message import + search dead code  (parallel-ok)

#147 is a real (latent) bug fix — case-sensitive tape-line skip; add the regression test first.


| Issue | Title | Files |
|---|---|---|
| [#147](https://github.com/chase-codes/helm/issues/147) | Fix case-sensitive tape-line skip corrupting date in message import | `src/shared/message/parseImport.ts`, `src/shared/message/parseImport.test.ts` |
| [#148](https://github.com/chase-codes/helm/issues/148) | Remove dead export formatTapeLabel from tapeNo.ts | `src/shared/message/tapeNo.ts` |
| [#149](https://github.com/chase-codes/helm/issues/149) | Remove dead fuzzyTok and correct matchTol consumer comment | `src/shared/search/fuzzy.ts`, `src/shared/search/fuzzy.test.ts` |

### B5 — Shared: songs + scripture helpers  (parallel-ok)

| Issue | Title | Files |
|---|---|---|
| [#150](https://github.com/chase-codes/helm/issues/150) | Share one section-label regex between detectChorus and splitToSlides | `src/shared/songs/detectChorus.ts`, `src/shared/songs/splitToSlides.ts` |
| [#151](https://github.com/chase-codes/helm/issues/151) | Extract shared canonicalBookIndex helper into scripture/books.ts | `src/shared/scripture/books.ts`, `src/shared/scripture/passages.ts`, `src/shared/search/verseScore.ts` |
| [#152](https://github.com/chase-codes/helm/issues/152) | Express matchBook's exact pass via matchBookExact in refs.ts | `src/shared/scripture/refs.ts` |

### B6 — Renderer: useHelm core  (sequential)

Fix in-branch in this order: #157 (extract useMainState + race fix) -> #138 (isolate clock) -> #142 (move file to renderer/shared, mechanical import-path edit last).


| Issue | Title | Files |
|---|---|---|
| [#157](https://github.com/chase-codes/helm/issues/157) | useHelm: extract useMainState, fix fetch/push race, dedupe subscriptions | `src/renderer/operator/UpdateFooter.tsx`, `src/renderer/operator/UpdatePill.tsx`, `src/renderer/operator/useHelm.ts` |
| [#138](https://github.com/chase-codes/helm/issues/138) | Isolate header clock to stop whole-header 1Hz re-renders | `src/renderer/operator/Header.tsx`, `src/renderer/operator/useHelm.ts` |
| [#142](https://github.com/chase-codes/helm/issues/142) | Move useHelm subscription hooks from operator/ to shared/ | `src/renderer/operator/useHelm.ts`, `src/renderer/shared/useHelm.ts`, `src/renderer/output/LeaderView.tsx`, `src/renderer/operator/PreServiceMode.tsx`, `src/renderer/operator/SlidesTrack.tsx`, `src/renderer/operator/Header.tsx`, `src/renderer/operator/SermonMode.tsx`, `src/renderer/operator/SongsMode.tsx`, `src/renderer/operator/MessageMode.tsx`, `src/renderer/operator/ReleaseToggle.tsx`, `src/renderer/operator/OutputViewPopover.tsx`, `src/renderer/operator/DisplaysSettings.tsx` |

### B7 — Renderer: transport/tint style kit  (sequential)

These three overlap on railTint.ts / transport.ts / PreServiceMode.tsx and propose overlapping helpers — reconcile into ONE helper set (liveTint, statusChipStyle, rail card/font helpers). Computed style values must stay byte-identical.


| Issue | Title | Files |
|---|---|---|
| [#136](https://github.com/chase-codes/helm/issues/136) | Centralize rail-card styles and shared rail font formula | `src/renderer/operator/railTint.ts`, `src/renderer/operator/ChapterRail.tsx`, `src/renderer/operator/ParagraphRail.tsx`, `src/renderer/operator/SectionRail.tsx` |
| [#137](https://github.com/chase-codes/helm/issues/137) | Share on-air status chip and ghost button styles | `src/renderer/operator/transport.ts`, `src/renderer/operator/PreServiceMode.tsx`, `src/renderer/operator/Header.tsx`, `src/renderer/operator/SongsMode.tsx`, `src/renderer/operator/SermonCenter.tsx` |
| [#140](https://github.com/chase-codes/helm/issues/140) | Share the tinted-chip (1c/55) style formula via one helper | `src/renderer/operator/railTint.ts`, `src/renderer/operator/transport.ts`, `src/renderer/operator/ModeCrashCard.tsx`, `src/renderer/operator/UpdatePill.tsx`, `src/renderer/operator/PreServiceMode.tsx` |

### B8 — Renderer: mode-surface helpers  (sequential)

| Issue | Title | Files |
|---|---|---|
| [#133](https://github.com/chase-codes/helm/issues/133) | Extract SermonMode verse-slide and resolve-and-take helpers | `src/renderer/operator/SermonMode.tsx` |
| [#134](https://github.com/chase-codes/helm/issues/134) | Unify SongsMode search refresh; three copies have drifted | `src/renderer/operator/SongsMode.tsx` |
| [#135](https://github.com/chase-codes/helm/issues/135) | Share list-kit delete-menu and pending-filter helpers | `src/renderer/operator/SermonMode.tsx`, `src/renderer/operator/MessageMode.tsx`, `src/renderer/operator/SlidesTrack.tsx`, `src/renderer/operator/useListSelection.ts`, `src/renderer/operator/useDeferredRemove.ts` |

### B9 — Renderer: output canvases + logo slide  (sequential)

| Issue | Title | Files |
|---|---|---|
| [#143](https://github.com/chase-codes/helm/issues/143) | SlideCanvas: hoist static style objects; use CANVAS_GOLD for accent fallback | `src/renderer/shared/SlideCanvas.tsx` |
| [#144](https://github.com/chase-codes/helm/issues/144) | ReadingCanvas: remove dead scrollRef and inert opacity; use MESSAGE_ACCENT | `src/renderer/shared/ReadingCanvas.tsx` |
| [#145](https://github.com/chase-codes/helm/issues/145) | Dedupe LEADER_BAND: reuse LYRICS_BAND instead of a drifting copy | `src/renderer/output/LeaderView.tsx`, `src/renderer/shared/SlideCanvas.tsx`, `src/shared/slides/fitText.ts` |
| [#146](https://github.com/chase-codes/helm/issues/146) | Fix stale 'no error boundary' rationale in useFitText comment and test | `src/renderer/shared/useFitText.ts`, `src/renderer/shared/useFitText.test.tsx` |
| [#153](https://github.com/chase-codes/helm/issues/153) | Centralize the HELM logo slide literal behind one shared helper | `src/shared/presentation/core.ts`, `src/shared/media/slides.ts`, `src/shared/preservice/cards.ts`, `src/renderer/operator/SermonCenter.tsx`, `src/renderer/operator/SlidesTrack.tsx`, `src/renderer/shared/SlideCanvas.tsx` |

### B10 — Renderer: chrome constants (wide mechanical)  (sequential)

#155 touches 26 files; keep it a pure token extraction with identical font strings.


| Issue | Title | Files |
|---|---|---|
| [#139](https://github.com/chase-codes/helm/issues/139) | Name the operator overlay z-index ladder as shared constants | `src/renderer/operator/zLayers.ts`, `src/renderer/operator/ModalShell.tsx`, `src/renderer/operator/ContextMenu.tsx`, `src/renderer/operator/SlidesTrack.tsx`, `src/renderer/operator/VersionPicker.tsx`, `src/renderer/operator/OutputViewPopover.tsx`, `src/renderer/operator/SongImport.tsx`, `src/renderer/operator/MessageImport.tsx` |
| [#141](https://github.com/chase-codes/helm/issues/141) | Remove dead regex and void escape hatch from csp.test.ts | `src/renderer/operator/csp.test.ts` |
| [#155](https://github.com/chase-codes/helm/issues/155) | Tokenize the two typeface stacks as named constants in fonts.ts | `src/renderer/shared/fonts.ts`, `src/renderer/operator/App.tsx`, `src/renderer/operator/ChapterRail.tsx`, `src/renderer/operator/DisplaysSettings.tsx`, `src/renderer/operator/Header.tsx`, `src/renderer/operator/MessageImport.tsx`, `src/renderer/operator/MessageSearchRail.tsx`, `src/renderer/operator/OutputViewPopover.tsx`, `src/renderer/operator/ParagraphRail.tsx`, `src/renderer/operator/PreServiceMode.tsx`, `src/renderer/operator/QuickAdd.tsx`, `src/renderer/operator/ReleaseToggle.tsx`, `src/renderer/operator/SchedulePanel.tsx`, `src/renderer/operator/SectionRail.tsx`, `src/renderer/operator/SermonCenter.tsx`, `src/renderer/operator/SettingsModal.tsx`, `src/renderer/operator/ShortcutsSettings.tsx`, `src/renderer/operator/SlidesTrack.tsx`, `src/renderer/operator/SongImport.tsx`, `src/renderer/operator/SongSearchRail.tsx`, `src/renderer/operator/SongsMode.tsx`, `src/renderer/operator/TapePlayer.tsx`, `src/renderer/operator/VersionPicker.tsx`, `src/renderer/output/LeaderView.tsx`, `src/renderer/shared/SlideCanvas.tsx`, `src/renderer/shared/ReadingCanvas.tsx` |

## Status

| Batch | Status | PR |
|---|---|---|
| B1 — Main-process seams | merged | [#161](https://github.com/chase-codes/helm/pull/161) |
| B2 — Main-process perf & repos | merged | [#160](https://github.com/chase-codes/helm/pull/160) |
| B3 — Chromium sandbox (medium risk) | open | |
| B4 — Shared: message import + search dead code | merged | [#158](https://github.com/chase-codes/helm/pull/158) |
| B5 — Shared: songs + scripture helpers | merged | [#159](https://github.com/chase-codes/helm/pull/159) |
| B6 — Renderer: useHelm core | merged | [#163](https://github.com/chase-codes/helm/pull/163) |
| B7 — Renderer: transport/tint style kit | merged | [#164](https://github.com/chase-codes/helm/pull/164) |
| B8 — Renderer: mode-surface helpers | merged | [#165](https://github.com/chase-codes/helm/pull/165) |
| B9 — Renderer: output canvases + logo slide | open | |
| B10 — Renderer: chrome constants (wide mechanical) | open | |
