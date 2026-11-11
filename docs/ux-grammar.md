# Helm UX interaction grammar

Nine rules the operator UI follows. The code already encodes them — mostly as comments
beside the guard that enforces each one — and this file consolidates them so a new
surface inherits the rules instead of re-deciding them. Each rule cites the code and tests
that enforce it. The rules came out of the 2026-08-15 operator UX eval and the issue cluster
it produced: #85, #86, #87, #88, #89, #90, #91, #92, with #22 (shift-click pivot) and #58
(double-click takes) behind rules 6 and 3.

What the controls are called (the ten words, ‹ Previous / Next ›, the rail hint sentence,
page names) lives in `docs/ux-vocabulary.md`.

The rules are stated for the **operator** window. The audience/leader output is a
different surface with its own constraints (see rule 8's carve-out).

## 1. Red means on-air. Only red.

One colour, `T.live`, says "the congregation sees this" on every page and in every theme
family. Green (`T.go`) is reserved for the opposite meaning — "put this on screen" — and
never reports state. Every page's status chip takes its words and tone from one helper,
`screenStatus()` (`src/shared/presentation/screenOwner.ts`), and its colour from
`screenToneColor()` (`src/renderer/operator/transport.ts`): own content `T.live`
(`LIVE ON SCREEN`), another page's content `T.faint` (`LIVE FROM SONGS` / `SERMON` /
`PRE-SERVICE`), logo `T.accent`, black `T.dim` (`NOTHING ON SCREEN`). The Header chip
keeps its own resolver (`Header.tsx:54`) because it is global.

On rows and heroes the signal is one ring and one word: whatever is on the audience
screen wears `liveRing(T)` (2px `T.live`) and the red `LIVE` badge, on every rail and both
heroes. The cued item, the delete-selection and the `QUEUED` badge wear the track colour
(`T.accent` for Songs and Pre-service, `T.scripture`, `T.message`, `T.sermon` for Slides),
never red.

**Enforced by**
- `src/shared/theme.ts:4` — `live` token on the `Theme` interface; every one of the ten palettes (`theme.ts:18-31`) defines it as a red, and `go` as a green.
- `src/shared/presentation/screenOwner.ts` — `pageOfKey` maps each live-key kind to its Header tab; `screenStatus` returns the chip's words and tone. `src/renderer/operator/transport.ts:95` `screenToneColor` turns the tone into a theme colour.
- `src/renderer/operator/SongsMode.tsx:733`, `SermonCenter.tsx:101`, `PreServiceMode.tsx:273` — every page chip calls `screenStatus`; the Pre-service comment records the hard-coded green this replaced (#87).
- `src/renderer/operator/Header.tsx:54` — the global chip's own resolver.
- `src/renderer/operator/transport.ts:11-13` — `go` documented as "the only colour that ever means put this on screen".
- `src/renderer/operator/PreServiceMode.test.tsx:506` — "paints LIVE ON SCREEN with %s live" pins the chip to `T.live` across two families and asserts `#3fb950` never renders; `src/shared/presentation/screenOwner.test.ts`, `SermonCenter.test.tsx:169` and `SongsMode.test.tsx:1375` pin the `LIVE FROM <PAGE>` words and the faint tone.
- `src/renderer/operator/railTint.ts:135` `liveRing`, `:166` `scheduleRowStyle` (live outranks the selection), `:61` `railRowStyle` (live ring is red, outranks a range).
- `src/renderer/operator/StateBadge.tsx` — `LiveBadge`, `QueuedBadge`, `RowStateMark` (LIVE over QUEUED over the cue dot).
- `src/renderer/operator/SermonCenter.tsx:191`, `SongsMode.tsx:956` — `data-hero-card`: red ring and LIVE badge only while the hero is on screen.
- Tests: `railTint.test.ts` and `StateBadge.test.tsx` "live and queued signals"; the "live and queued signals" describes in `SchedulePanel.test.tsx`, `SlidesTrack.test.tsx`, `MessageSearchRail.test.tsx`, `SongSearchRail.test.tsx`; `theme.test.ts` "the Slides track colour is not a second green".

**Why:** the operator's most important signal must not change colour with the page they are on.

## 2. Transport bars are stable ground.

Take down and Go live have fixed slots at a fixed width (`150px`) in every state; Take down
is always rendered (ghosted when there is nothing to take down) and the primary slot only
ever means "put this on screen". Anything variable-width sits to the *left* of the flex
spacer, so state changes recolour and relabel, never reflow. The primary is labelled Go
live in every state, including while a song or reading is queued; what it will put up rides
in the tooltip (`Go live with <title>`), never the label. The step buttons left of the
spacer read `‹ Previous` and `Next ›` on every page; the unit lives in their tooltip.

**Enforced by**
- `src/renderer/operator/transport.ts:5-9` — `TRANSPORT_VERB_W = '150px'`, applied unconditionally at `:23` by `primaryBtnStyle`; `:10-18` the `go | down | ghost` looks; `:45-62` Prev/Next content-sized because they sit left of the spacer; `:90-97` the divider between adjacent opposite verbs.
- `src/renderer/operator/SongsMode.tsx:1020-1047` — the bar: spacer, Take down, divider, primary; `:1041` the queued song's title in `title=`, the label always Go live.
- `src/renderer/operator/SermonCenter.tsx:256-290` — same slots; the version picker stays left of the verbs; `:39` `queuedTitle` arms Go live and names the queued item in the tooltip.
- `src/renderer/operator/SermonCenter.test.tsx:69-110` and `SongsMode.test.tsx:1245-1291` — "the transport is stable ground (#85)": Take down always present, primary never relabels to the opposite verb, right-anchored ordering under a wide picker.

**Why:** the transport is the one row an operator must be able to hit without looking.

## 3. Click cues, double-click takes, Enter commits.

The screen has exactly four verbs, all decided in main against authoritative state:

| Verb | Starts projecting | Stops projecting | Gesture |
|---|---|---|---|
| `applyCue` | no | no | single click / selection; a scripture cursor MOVE (not activation) also cues so the leader display can follow while output is down (#188) |
| `showLive` | no | no (follows within the same kind) | cursor navigation, arrows |
| `takeLive` | yes | **never** (idempotent) | double-click, Shift+Enter, "put this up" |
| `goLive` | yes | yes (same key → black) | the Go live button and Enter |

Only `goLive` toggles, and since #85 the Go live button and Enter ghost when the cued item
is already live, so in the operator UI only Take down, the Header chip and Escape take the
screen down; `goLive`'s toggle branch remains in the kernel. A card gesture routes through
`takeLive` and can never black the projector. Deletes use a
fifth, non-gesture verb, `invalidate`: deleted content that is live goes black, a black or
logo screen keeps its mode. Enter is the button's twin and ghosts where the button ghosts.

**QUEUED.** When content of one kind holds the screen and the operator clicks a different
item of that kind, the click lines it up instead of switching: the row says `QUEUED` in the
track colour and Go live, Enter or a double click takes it. Songs (`armedNextId`), the
Scripture schedule (`queuedReadingId`), Message quote rows (`queuedQuote` for the tape on
screen, `isQueuedBehind` for another tape) and Slides (`isQueuedBehind`, `core.ts:50`).
Escape clears a queue before it touches the screen; taking the screen down turns the
queued item into the cue.

**Exception:** scripture's verse rail and Message's paragraph rail are cursor models, not
cue models: while their content is live, a plain tap on a verse or paragraph card (and the
arrows) moves the cursor onto the screen. That is allowed only because the rail carries the
hint on-surface (`railHint('verse', ...)` at `ChapterRail.tsx:38`; `railHints.ts` is the sentence's single
source). The Scripture **schedule** and Message **quote rows**
are not part of the exception: a click (or the reading hotkey) while that content is live
only queues it (decision 3, 2026-10-11, `SermonMode.tsx:652` `pickReading`; the quote-row
default of 2026-10-12, `MessageMode.tsx:433` `pickQuote`); double click or Go live takes it.
Pre-service is the same shape as the verse rail: a tap switches cards only while
pre-service is already projecting, never starts it.

**Enforced by**
- `src/shared/presentation/core.ts:46-51` `applyCue`; `:52-58` `goLive` (toggle branch); `:59-75` `takeLive` (identity return so `stateStore.take` skips the broadcast); `:76-98` `showLive` (`sameKind` guard); `:108-129` `invalidate`; `:99-107` `setOutput` refuses `'live'` with no key.
- `docs/superpowers/specs/2026-08-14-double-click-go-live-design.md` — the eight double-click surfaces, `onActivate` mirrors `onSelect`, no debounce, `userSelect: 'none'`.
- `src/renderer/operator/SermonMode.tsx:631-637`, `:696-701` — Shift+Enter and search-hit activation use `take`, not `goLive`, "blanking is never what was asked for".
- `src/renderer/operator/MessageMode.tsx:350-353` `followAlong` uses `take`, so a repeat click on the live reading view is a no-op; pinned by `SermonMode.test.tsx:1768`.
- `src/renderer/operator/keyDispatch.ts:71-76` — `go.live` → `handler.onGoLive()` behind the modal guard.
- `src/renderer/operator/ChapterRail.tsx:37-45`, `:132-134` — the cursor-model hint and the rail's contract; `SermonMode.tsx:492-516` the show effect (cue-on-move + show) + `:523` `cuedIsLive` via `sameKind`.
- `src/renderer/operator/PreServiceMode.tsx:41-44` — `PRE_HINT` and the BUG-018 promise.
- `src/shared/presentation/core.test.ts` — `takeLive` idempotent on the live key; `isQueuedBehind`; `SongsMode.test.tsx:1273` — Enter is a no-op, not a take-down, when the cue is already live.
- `SermonMode.test.tsx` "a schedule click while scripture is live queues it (decision 3)" and "a quote row in the tape on screen only queues (2026-10-12 default)".
- `src/renderer/operator/railHints.ts` — `railHint()`, the one rail hint sentence; used by `SectionRail.tsx:187`, `ChapterRail.tsx:38`, `ParagraphRail.tsx:23`, `SlidesTrack.tsx:602` and `PreServiceMode.tsx:327`; `railHints.test.ts`.

**Why:** an impatient extra click on the card already showing must never black the projector (#58).

## 4. In-service actions never confirm — they undo.

Deleting from any in-service schedule is immediate and optimistic, with a self-clearing
toast, `Deleted <thing>` plus Undo (5 s), whose undo restores the list *exactly*, position included. Schedules share
one implementation, `useDeferredRemove`, and one `removeMany` covers single delete,
shift-range and Clear all. Clear all is a `DangerGhostButton` in the list header of every
schedule (Scripture, Message); libraries and the pre-service loop have none. Dialogs and
two-step confirms belong to Settings and to libraries.

**Carve-out: libraries confirm.** The song library and the media library confirm instead
of undoing. A schedule is this Sunday's plan; a library is every Sunday's store, so
deleting from it is library management that happens to live on an in-service page, and
deleting media also removes its files from disk. Both use one two-step confirm,
`useLibraryDelete`: right-click "Delete from library", then "Really delete?" in place in
the same menu; the item on screen is refused with the reason. Neither answers the Delete
key or multi-select: no single keystroke and no range may empty a library.

**Exception: pre-service commits now.** Pre-service cards are deleted at once and undone
by re-inserting each card at its original index (`useTimedUndo` plus
`preservice.restoreCard`), not through `useDeferredRemove`'s deferred commit. The rotation
lives in main, and a card left pending there for five seconds could rotate onto the
audience screen after the operator deleted it. Same toast, same 5 s, same exact restore;
only the moment of commit differs.

**Enforced by**
- `src/renderer/operator/useDeferredRemove.ts:39-58` — the rule-bearer: deferred commit, position-restoring undo; `:12-27` the `pendingNow()` contract; `:115-125` `filterPending`.
- `src/renderer/operator/useTimedUndo.ts:13-18` (the 5000 ms primitive) and `PreServiceMode.tsx:79`, `:85-104` `removeCards`/`undoRemove`, with `src/main/preserviceEngine.ts:176` `restoreCard`: the pre-service commit-now exception.
- `src/renderer/operator/UndoToast.tsx:14` — track-agnostic `Deleted <label>` toast, accent follows the host track (#92); `UndoToast.test.tsx`.
- `src/renderer/operator/DangerGhostButton.tsx:9-24` — Clear all: real button footprint, "No confirmation dialog, on purpose"; adopters `SchedulePanel.tsx:214` (Scripture) and `MessageSearchRail.tsx:287` (Message).
- Adopters: `SermonMode.tsx:149` (scripture) and `MessageMode.tsx:115` (quotes); main half of pre-service in `src/main/preCardsRepo.ts:32`.
- Settings side: `src/renderer/operator/SettingsModal.tsx:59`, `:83-87`, `:170-193`, `:404-407` — the 4 s two-click Bible uninstall; `ModalShell.tsx:27-35` the one modal shell.
- Library carve-out: `src/renderer/operator/useLibraryDelete.ts:42` (labels `:13-15`, arm guard, lapse, live refusal); adopters `SongsMode.tsx:468` `onSongContextMenu` and `SlidesTrack.tsx:208` `deleteItem`; `ContextMenu.tsx:19-23` `keepOpen`; `useLibraryDelete.test.tsx`, `SongsMode.test.tsx:1039` and `SlidesTrack.test.tsx:329` ("Delete from library confirms rather than undoing").
- `src/renderer/operator/PreServiceMode.test.tsx:208` — "card removal speaks the in-service grammar (#86, #90)".

**Why:** mid-service, a blocking dialog is worse than a recoverable mistake, and an undo that re-appends silently reorders the schedule.

## 5. Dynamic text never resizes its container.

Titles, references and labels appear only where the footprint is fixed and the text
truncates: `flexShrink: 0` on the badge, `minWidth: 0` + nowrap + ellipsis on the sibling.
Buttons say what the click *does*, not what state is, so their width is constant. Modals
with variable steps get a fixed frame.

**Enforced by**
- `src/renderer/operator/transport.ts:9`, `:23` — fixed verb width, ghosts still occupy the slot.
- `src/renderer/operator/StateBadge.tsx`, `railTint.ts:142` `queuedBadgeStyle` — QUEUED badge `flexShrink: 0`, nowrap; on the Songs rail (`SongSearchRail.tsx:136-137`) it dims on the row whose click clears it rather than swapping copy; title/author truncate.
- `src/renderer/operator/SermonCenter.tsx:233-237`, `SlidesTrack.tsx:598-601`, `SongsMode.tsx:918`, `UndoToast.tsx:28-30` — the `minWidth: 0` + ellipsis pair.
- `src/renderer/operator/Header.tsx:45-51`, `:100` — live label clamped to 30 chars, nowrap.
- `src/renderer/operator/railTint.ts:115-130` — two-line clamp for rail bodies.
- `src/renderer/operator/PreServiceMode.tsx:236-239` — labels say what the click does (#92), which is what makes the row width constant.
- `src/renderer/operator/ModalShell.tsx:16-17` — fixed `height` so a wizard does not resize under the operator.
- `src/renderer/operator/SlidesTrack.tsx:448-450`, `Header.tsx:200` — tabular numerals so counters do not jitter.

**Why:** a control whose position depends on the song library cannot be hit by muscle memory.

## 6. Every list gets the same powers.

A schedule-shaped list is built from one kit: `useListSelection` for single/multi
selection, `ModeKeyHandler.onDelete` for the Delete key, and `deleteMenuItems` for the
right-click menu (`Delete N <noun>` inside a multi-selection, otherwise select-then-`Delete`).
Shift-click ranges from an anchor that stays put — a second shift-click re-ranges, it never
grows — and the scripture rail's `railSelect` makes the same anchor-vs-selection split for
verses, including the idempotence a shift-double-click depends on. The same kit answers the
keyboard: Escape clears the selection before it can touch the screen, and digits 1 to 9
click row N (rule 9). `deleteMenuItems`
takes an optional `canDelete` filter for rows that may never go (the pre-service logo
card); the label counts only what will actually be deleted.

Every rail has its add control in one place: a full-width chip that is the first control
under the rail's input (Songs, Scripture, Message) or under its header (Slides,
Pre-service), never in a list header and never at the foot of the list. It names what it
will file (`+ Add John 3:16`, `+ Add ¶3`), or says Import when the source is a file
(Slides). Importing from outside sits as a secondary row beneath it (Songs, Message).
Right-click Edit is offered wherever a row has an editor (Songs, Pre-service), for a single
row only.

**Enforced by**
- `src/renderer/operator/useListSelection.ts:4-17` — the `ListSelection` API; `:19-26` the kit stated; `:41-55` `selectTo` pivot; `:68-104` `DeleteMenuOptions` and `deleteMenuItems`.
- `src/shared/scripture/selection.ts:16-22`, `:24-45`, `:68-89` — `RailSelection.anchor`, the anchor precedence ladder, the carried/typed anchor rules (#22, #58).
- `src/renderer/operator/App.tsx:42-47` — `onDelete` contract; `keyDispatch.ts:77-83` — `item.delete` guarded behind Settings/modals; `src/shared/hotkeys/actions.ts:48`.
- Adopters: `SermonMode.tsx:145`/`:984` (`'verses'`), `MessageMode.tsx:114`/`:535` (`'quotes'`), `PreServiceMode.tsx:78`/`:443` (`'cards'`, with `canDelete`).
- Deliberate non-adopters: `SongsMode.tsx` and `SlidesTrack.tsx`, the two libraries (rule 4 carve-out).
- Add chips: `SongSearchRail.tsx:235` `addChipStyle`, `SchedulePanel.tsx:100` `schedAddStyle`, `MessageSearchRail.tsx:169` `addChipStyle` and `:155` import row, `SlidesTrack.tsx:383` `importChipStyle`, `PreServiceMode.tsx:200` `addChipStyle`.
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
- Every status chip says `NOTHING ON SCREEN` when black (`screenStatus`), as do the Header and leader view.
- First-run lines: `SongSearchRail.tsx:327-330`, `SchedulePanel.tsx:222-224`, `SlidesTrack.tsx:520-522`, `MessageSearchRail.tsx:298-306`, `PreServiceMode.tsx:335-337` (names `+ Add a card` in bold; `PreServiceMode.test.tsx:382`), `ScriptureSearchResults.tsx:98-99`.
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

## 9. Every page answers the same keys.

Escape backs out one layer per press, in one order on every page: close the popover or
modal, cancel the edit in progress, clear the selection (or the queued song), leave the
text field, and only then take the screen down, and only while something is live. A
popover that keeps its own open state closes itself before the page ladder runs. `/`
focuses the page's search and Mod+Backspace clears it; Slides and Pre-service have no
search, so the key does nothing there and Settings → Shortcuts says so. Digits 1 to 9 act
as a click on row N of the page's schedule, and the first nine rows wear their digit;
Songs reads digits as Verse N and Slides as slide N of the cued deck, whose rail is already
numbered. Shift+Enter is an entry-field gesture (the Scripture entry's "take this reference
live") and has no page-level binding.

**Enforced by**
- `src/renderer/operator/escapeLadder.ts:21-36`: `EscapeLadder` and `runEscapeLadder`, the rung order; `:40` `blurFocusedField`, `:49` `takeDownWhenLive`, `:59` `clearSelectionRung`; `escapeLadder.test.ts`.
- Adopters: `SongsMode.tsx:745` (`onEscape`), `SermonMode.tsx:1040` (`onEscape`; `:1049` routes `clearSelection` and `:1078` routes `onAction` to `MessageKeyHandler` / `SlidesKeyHandler`), `MessageMode.tsx:409-421`, `SlidesTrack.tsx:385`, `PreServiceMode.tsx:152` (`onEscape`), `:177` (`onAction`).
- `src/renderer/operator/useEscapeToClose.ts:11`: capture-phase close for `VersionPicker.tsx:23` and `OutputViewPopover.tsx:31`; `ContextMenu.tsx:165` keeps the same contract for its own keys.
- `src/shared/hotkeys/actions.ts:60-68`: the global `item.jump` digit block, shadowed on Songs by `song.verse` (`:73`); `:24` `note`, rendered by `ShortcutsSettings.tsx:152-159`.
- `src/renderer/operator/keyDispatch.ts:34`: Escape first; `:85` registry actions behind the typing and modal guards; `keyDispatch.test.ts:160` pins digits on every scope.
- `src/renderer/operator/RowNumber.tsx:8`: `SchedulePanel.tsx:238`, `MessageSearchRail.tsx:286`, `PreServiceMode.tsx:458`.
- Mode tests: "Escape backs out progressively" (`SermonMode.test.tsx:1274`) and the quote schedule list kit (`:2284`), "SongsMode escape chain" (`SongsMode.test.tsx:680`), "the Escape ladder" (`PreServiceMode.test.tsx:570`).

**Why:** an operator moving between pages must not have to remember which page blacks the screen on the first Escape, or which page ignores the number keys.

## Known gaps

Facts as of 2026-10-12, not tasks:

- Rule 8 has no lint enforcement. `eslint.config.mjs:24-28` carries no raw-colour rule; the only automated check is the single `not.toContain('3fb950')` assertion.
- `T.live` doubles as the danger/error colour (`ContextMenu.tsx:200`, `DangerGhostButton.tsx:34`, `SettingsModal.tsx:275-295`, `QuickAdd.tsx:287`, and others), so rule 1's "only red" holds for on-air state but red does not mean *only* on-air.
- There is no `goInk` token alongside `accentInk`; `'#fff'` is hard-coded on the green verb at `transport.ts:34`, `PreServiceMode.tsx:232` and `TrackTabs.tsx:37`.
- `src/renderer/output/LeaderView.tsx:209` and `:225` hard-code `#221d10` and `#b4b1aa`, which are `CLASSIC_DARK.selBg` and `CLASSIC_DARK.lineDim`.
- The pre-service transport does not use `primaryBtnStyle`; it fakes rule 2 with `minWidth: '150px'` and still sets `flexWrap: 'wrap'`, and its steps are still bare `‹` / `›` (decision 4 pending).
- The status chip is page-level (decision 6): on the Sermon page a live slide from the Slides track reads `LIVE ON SCREEN` on the Scripture track too.
- Message's `+ Import` opens Settings (`MessageMode.tsx:585` `onOpenSettings`) rather than the import modal itself; Slides and Songs import in place.
- The `Header` live chip changes height with state (`Header.tsx:96`, 28 → 32 px), a documented exception (`transport.ts:64-67`).
- The Message quote schedule has no add path (`MessageSearchRail.tsx` empty-state comment), so its digit jumps and row numbers have nothing to act on until one lands.
- Escape's clear-selection rung fires on any non-empty selection, and a plain click selects a row on Scripture, Message and Pre-service, so after a click Escape takes two presses to reach the screen. `clearSelectionRung` is the one place to change if that should apply to ranges only.
