# Helm UX interaction grammar

Eight rules the operator UI follows. The code already encodes them — mostly as comments
beside the guard that enforces each one — and this file consolidates them so a new
surface inherits the rules instead of re-deciding them. Each rule cites the code and tests
that enforce it. The rules came out of the 2026-08-15 operator UX eval and the issue cluster
it produced: #85, #86, #87, #88, #89, #90, #91, #92, with #22 (shift-click pivot) and #58
(double-click takes) behind rules 6 and 3.

The rules are stated for the **operator** window. The audience/leader output is a
different surface with its own constraints (see rule 8's carve-out).

## 1. Red means on-air. Only red.

One colour, `T.live`, says "the congregation sees this" on every page and in every theme
family. Green (`T.go`) is reserved for the opposite meaning — "put this on screen" — and
never reports state. Every on-air resolver is the same expression:
`black → T.dim, logo → T.accent, live → T.live`.

**Enforced by**
- `src/shared/theme.ts:4` — `live` token on the `Theme` interface; every one of the ten palettes (`theme.ts:18-31`) defines it as a red, and `go` as a green.
- `src/renderer/operator/Header.tsx:52`, `SermonCenter.tsx:90`, `SongsMode.tsx:784` — the three identical on-air colour resolvers.
- `src/renderer/operator/PreServiceMode.tsx:261-267` — `projColor = preOwnsScreen ? T.live : T.faint`; the comment records the hard-coded green this replaced (#87).
- `src/renderer/operator/transport.ts:11-13` — `go` documented as "the only colour that ever means put this on screen".
- `src/renderer/operator/PreServiceMode.test.tsx:432-449` — pins PROJECTING to `T.live` across two families and asserts `#3fb950` never renders.

**Why:** the operator's most important signal must not change colour with the page they are on.

## 2. Transport bars are stable ground.

Take down and Go live have fixed slots at a fixed width (`150px`) in every state; Take down
is always rendered (ghosted when there is nothing to take down) and the primary slot only
ever means "put this on screen". Anything variable-width sits to the *left* of the flex
spacer, so state changes recolour and relabel, never reflow. A varying song title rides in
the tooltip, never the label.

**Enforced by**
- `src/renderer/operator/transport.ts:5-9` — `TRANSPORT_VERB_W = '150px'`, applied unconditionally at `:23` by `primaryBtnStyle`; `:10-18` the `go | down | ghost` looks; `:45-62` Prev/Next content-sized because they sit left of the spacer; `:90-97` the divider between adjacent opposite verbs.
- `src/renderer/operator/SongsMode.tsx:985-1019` — the bar: spacer, Take down, divider, primary; `:1011` armed title in `title=`, `:1013` label swaps only to the constant `⇄ Switch`.
- `src/renderer/operator/SermonCenter.tsx:171-174`, `:241-277` — same slots; the version picker stays left of the verbs.
- `src/renderer/operator/SermonCenter.test.tsx:69-110` and `SongsMode.test.tsx:1245-1291` — "the transport is stable ground (#85)": Take down always present, primary never relabels to the opposite verb, right-anchored ordering under a wide picker.

**Why:** the transport is the one row an operator must be able to hit without looking.

## 3. Click cues, double-click takes, Enter commits.

The screen has exactly four verbs, all decided in main against authoritative state:

| Verb | Starts projecting | Stops projecting | Gesture |
|---|---|---|---|
| `applyCue` | no | no | single click / selection |
| `showLive` | no | no (follows within the same kind) | cursor navigation, arrows |
| `takeLive` | yes | **never** (idempotent) | double-click, Shift+Enter, "put this up" |
| `goLive` | yes | yes (same key → black) | the Go live button and Enter |

Only `goLive` toggles, so only the button and its keyboard twin can take the screen down;
a card gesture routes through `takeLive` and can never black the projector. Deletes use a
fifth, non-gesture verb, `invalidate`: deleted content that is live goes black, a black or
logo screen keeps its mode. Enter is the button's twin and ghosts where the button ghosts.

**Exception:** scripture is a cursor model, not a cue model — while output is live a plain
tap on a verse moves the cursor onto the screen. That is allowed only because the rail
carries the hint on-surface (`ChapterRail.tsx:37`). Pre-service is the same shape: a tap
switches cards only while pre-service is already projecting, never starts it.

**Enforced by**
- `src/shared/presentation/core.ts:46-51` `applyCue`; `:52-58` `goLive` (toggle branch); `:59-75` `takeLive` (identity return so `stateStore.take` skips the broadcast); `:76-98` `showLive` (`sameKind` guard); `:108-129` `invalidate`; `:99-107` `setOutput` refuses `'live'` with no key.
- `docs/superpowers/specs/2026-08-14-double-click-go-live-design.md` — the eight double-click surfaces, `onActivate` mirrors `onSelect`, no debounce, `userSelect: 'none'`.
- `src/renderer/operator/SermonMode.tsx:604-609`, `:672-676` — Shift+Enter and search-hit activation use `take`, not `goLive`, "blanking is never what was asked for".
- `src/renderer/operator/keyDispatch.ts:67-73` — `go.live` → `handler.onGoLive()` behind the modal guard.
- `src/renderer/operator/ChapterRail.tsx:37-45`, `:132-134` — the cursor-model hint and the rail's contract; `SermonMode.tsx:490-503` the show effect + `cuedIsLive` via `sameKind`.
- `src/renderer/operator/PreServiceMode.tsx:41-44` — `PRE_HINT` and the BUG-018 promise.
- `src/shared/presentation/core.test.ts` — `takeLive` idempotent on the live key; `SongsMode.test.tsx:1273` — Enter is a no-op, not a take-down, when the cue is already live.

**Why:** an impatient extra click on the card already showing must never black the projector (#58).

## 4. In-service actions never confirm — they undo.

Removing from any in-service list is immediate and optimistic, with a self-clearing
"Removed — Undo" toast (5 s) whose undo restores the list *exactly*, position included.
One shared implementation; one `removeMany` covers single delete, shift-range and Clear all.
Dialogs and two-step "Remove — sure?" belong to Settings.

**Carve-out:** the song library confirms instead of undoing. A schedule is this Sunday's
plan; the library is every Sunday's, so removing from it is library management that
happens to live on an in-service page. It borrows Settings' two-step confirm and answers
neither the Delete key nor multi-select.

**Enforced by**
- `src/renderer/operator/useDeferredRemove.ts:39-58` — the rule-bearer: deferred commit, position-restoring undo; `:12-27` the `pendingNow()` contract; `:115-125` `filterPending`.
- `src/renderer/operator/useTimedUndo.ts:13-18` — the 5000 ms timer primitive (still used by pre-service cards, `PreServiceMode.tsx:78`).
- `src/renderer/operator/UndoToast.tsx:3-14` — track-agnostic toast, accent follows the host track (#92).
- `src/renderer/operator/DangerGhostButton.tsx:9-24` — Clear all: real button footprint, "No confirmation dialog, on purpose"; `SchedulePanel.tsx:50-55`.
- Adopters: `SermonMode.tsx:147`/`:566-580`, `MessageMode.tsx:115`, `SlidesTrack.tsx:121`; main half in `src/main/preCardsRepo.ts:32`.
- Settings side: `src/renderer/operator/SettingsModal.tsx:59`, `:83-87`, `:170-193`, `:404-407` — the 4 s two-click Bible uninstall; `ModalShell.tsx:27-35` the one modal shell.
- Library carve-out: `src/renderer/operator/SongsMode.tsx:447-472`, `:508`; `ContextMenu.tsx:19-21` `keepOpen`; `SongsMode.test.tsx:1067` "Confirm-grammar surfaces do not also offer an undo."
- `src/renderer/operator/PreServiceMode.test.tsx:208` — "card removal speaks the in-service grammar (#86, #90)".

**Why:** mid-service, a blocking dialog is worse than a recoverable mistake, and an undo that re-appends silently reorders the schedule.

## 5. Dynamic text never resizes its container.

Titles, references and labels appear only where the footprint is fixed and the text
truncates: `flexShrink: 0` on the badge, `minWidth: 0` + nowrap + ellipsis on the sibling.
Buttons say what the click *does*, not what state is, so their width is constant. Modals
with variable steps get a fixed frame.

**Enforced by**
- `src/renderer/operator/transport.ts:9`, `:23` — fixed verb width, ghosts still occupy the slot.
- `src/renderer/operator/SongSearchRail.tsx:52-61`, `:122-144` — NEXT badge `flexShrink: 0`, dims rather than swaps copy; title/author truncate.
- `src/renderer/operator/SermonCenter.tsx:233-237`, `SlidesTrack.tsx:598-601`, `SongsMode.tsx:918`, `UndoToast.tsx:28-30` — the `minWidth: 0` + ellipsis pair.
- `src/renderer/operator/Header.tsx:45-51`, `:100` — live label clamped to 30 chars, nowrap.
- `src/renderer/operator/railTint.ts:115-130` — two-line clamp for rail bodies.
- `src/renderer/operator/PreServiceMode.tsx:236-239` — labels say what the click does (#92), which is what makes the row width constant.
- `src/renderer/operator/ModalShell.tsx:16-17` — fixed `height` so a wizard does not resize under the operator.
- `src/renderer/operator/SlidesTrack.tsx:495-497`, `Header.tsx:200` — tabular numerals so counters do not jitter.

**Why:** a control whose position depends on the song library cannot be hit by muscle memory.

## 6. Every list gets the same powers.

A schedule-shaped list is built from one kit: `useListSelection` for single/multi
selection, `ModeKeyHandler.onDelete` for the Delete key, and `deleteMenuItems` for the
right-click menu (`Delete N <noun>` inside a multi-selection, otherwise select-then-`Delete`).
Shift-click ranges from an anchor that stays put — a second shift-click re-ranges, it never
grows — and the scripture rail's `railSelect` makes the same anchor-vs-selection split for
verses, including the idempotence a shift-double-click depends on.

**Enforced by**
- `src/renderer/operator/useListSelection.ts:4-17` — the `ListSelection` API; `:19-26` the kit stated; `:41-55` `selectTo` pivot; `:68-86` `deleteMenuItems`.
- `src/shared/scripture/selection.ts:16-22`, `:24-45`, `:68-89` — `RailSelection.anchor`, the anchor precedence ladder, the carried/typed anchor rules (#22, #58).
- `src/renderer/operator/App.tsx:40-45` — `onDelete` contract; `keyDispatch.ts:74-82` — `item.delete` guarded behind Settings/modals; `src/shared/hotkeys/actions.ts:36`.
- Adopters: `SermonMode.tsx:143`/`:964` (`'verses'`), `MessageMode.tsx:114`/`:522` (`'quotes'`), `SlidesTrack.tsx:118`/`:592` (`'items'`), `PreServiceMode.tsx:77`.
- Deliberate non-adopter: `SongsMode.tsx:450-453` — the library (rule 4 carve-out).
- `src/shared/scripture/selection.test.ts:148` — "the same semantics `useListSelection.selectTo` gives the schedule."
- `docs/superpowers/specs/2026-07-06-interaction-primitives-design.md`, `2026-08-15-scripture-schedule-multiselect-design.md`.

**Why:** a gesture that works in one rail and not another is worse than none — the operator learns to trust it.

## 7. Empty is an invitation.

Every list and panel has a first-run line that names what would live there *and* the
control that fills it (in `<b>`), never a bare "Nothing yet". Go live ghosts and stops
responding when there is nothing to take; Take down ghosts when nothing is on screen; both
tooltips say why.

**Enforced by**
- `src/renderer/operator/ListEmpty.tsx:4-18` — the shared empty state and its prop contract (#88).
- First-run lines: `SongSearchRail.tsx:327-330`, `SchedulePanel.tsx:222-224`, `SlidesTrack.tsx:565-567`, `MessageSearchRail.tsx:253-263`, `PreServiceMode.tsx:325-328`, `ScriptureSearchResults.tsx:98-99`.
- `src/renderer/operator/SermonCenter.tsx:30-34` — `canGoLive` contract; `:172-174`, `:267-274` ghost + "Nothing to take" tooltip; `:259` "Nothing on screen".
- `src/renderer/operator/SongsMode.tsx:882-885`, `:1002`, `:1010`; `PreServiceMode.tsx:241-248`.
- `src/renderer/operator/transport.ts:36-42` — the ghost look, "the slot holds its ground, disabled".
- `src/shared/presentation/core.ts:99-107` — kernel counterpart: `'live'` with no key is refused.

**Why:** a green, armed button over an empty hero promises something that cannot happen.

## 8. Colors come from the theme, nowhere else.

Operator chrome takes every colour from `src/shared/theme.ts` via `ThemeCtx`; tints are
derived by suffixing a hex token with alpha (`railTint`, `tintChip`), never spelled as raw
`rgba()`. A new semantic gets a token or it does not ship. Z-index (`zLayers.ts`) and
type (`fonts.ts`) follow the same one-ladder rule.

**Carve-out:** the audience and mirror canvases (`SlideCanvas`, `ReadingCanvas`,
`VideoCanvas`, `OutputRoot`/`OutputApp`/`MirrorView`) render on the projector, which does
not follow the operator's theme pick. Their palettes and `#000` backgrounds are not themed
chrome. `LeaderView` renders operator-dark by design (`theme.ts:42`) and uses `DARK`.

**Enforced by**
- `src/shared/theme.ts:1-13` — the 19 tokens + derived `floatShadow`/`modalShadow`/`scrim`; `:18-31` ten palettes; `:44-52` `themeFor`.
- `src/renderer/operator/ThemeCtx.ts`, `useAppearance.ts` — distribution and persistence.
- `src/renderer/operator/railTint.ts:5-16`, `:25-40` — `railTint` / `tintChip`, hex-token-plus-alpha only (#91, #140).
- `src/renderer/operator/ModalShell.tsx:27-35` — `T.scrim` / `T.modalShadow` replaced six hand-rolled rgba pairs.
- `src/renderer/operator/zLayers.ts`, `src/renderer/shared/fonts.ts`.
- `src/shared/theme.test.ts` — contrast floor on the palettes.
- `src/renderer/operator/PreServiceMode.test.tsx:449` — the one literal-hex guard.

**Why:** a colour written once in a component is a colour that ignores four of the five theme families.

## Known gaps

Facts as of 2026-08-28, not tasks:

- Rule 8 has no lint enforcement. `eslint.config.mjs:24-28` carries no raw-colour rule; the only automated check is the single `not.toContain('3fb950')` assertion.
- `T.live` doubles as the danger/error colour (`ContextMenu.tsx:200`, `DangerGhostButton.tsx:34`, `SettingsModal.tsx:275-295`, `QuickAdd.tsx:287`, and others), so rule 1's "only red" holds for on-air state but red does not mean *only* on-air.
- There is no `goInk` token alongside `accentInk`; `'#fff'` is hard-coded on the green verb at `transport.ts:34`, `PreServiceMode.tsx:232` and `TrackTabs.tsx:37`.
- `src/renderer/output/LeaderView.tsx:209` and `:225` hard-code `#221d10` and `#b4b1aa`, which are `CLASSIC_DARK.selBg` and `CLASSIC_DARK.lineDim`.
- The pre-service transport does not use `primaryBtnStyle`; it fakes rule 2 with `minWidth: '150px'` (`PreServiceMode.tsx:240-242`) and still sets `flexWrap: 'wrap'` (`:285`).
- The `Header` live chip changes height with state (`Header.tsx:96`, 28 → 32 px), a documented exception (`transport.ts:64-67`).
