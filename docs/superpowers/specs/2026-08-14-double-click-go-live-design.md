# Double-click any card to go live

Issue #58. Selecting a card cues it; going live needs a second, separate action. Double-clicking a card should go live directly, on every surface where a card can be selected.

There is no double-click handling anywhere in the renderer today, so this is net-new on all eight surfaces rather than an extension of one.

## The hazard

`goLive` in `src/shared/presentation/core.ts:50` blacks the output when fired on the key already live. That is right for a Go live / Take down button and wrong for a card. A naive "double-click calls goLive" means double-clicking an already-live card **blacks the projector** — the operator's most destructive accident, triggered by an impatient extra click.

Double-click must resolve to "put this on screen," idempotently. Escape and the Go Live button remain the ways to black the screen.

## 1. The verb

The app already has a vocabulary for the screen, each verb with one job. Double-click needs one that does not exist: deliberate takeover that never stops.

| Verb | Starts projecting? | Stops projecting? |
|---|---|---|
| `applyCue` | no | no |
| `showLive` | no | no |
| `takeLive` (new) | yes | no |
| `goLive` | yes | yes (same key → black) |

```ts
/** Double-click's route to the screen: deliberate takeover that is IDEMPOTENT.
 *  `goLive` minus the toggle branch, so an impatient extra click can never black
 *  the projector. Returns `st` BY IDENTITY when the key is already live, which lets
 *  the store skip the broadcast entirely — a no-op double-click must not re-send the
 *  output payload to a window playing video. */
export function takeLive(st: PresentationState, key: string, slide: Slide): PresentationState {
  if (st.output === 'live' && st.liveKey === key) return st
  return { ...st, output: 'live', liveKey: key, liveSnap: slide, cuedKey: key, cuedSnap: slide }
}
```

The identity return matters beyond tidiness. Every other verb broadcasts unconditionally, and a broadcast re-sends `outputSlide` to every output window. Double-clicking the deck slide that is already live would re-push an identical `{kind:'video'}` payload at a `<video>` element that is mid-playback. `stateStore.take` therefore skips the broadcast when the verb returns the state it was given.

The decision lives in main, against authoritative state, so no surface can get it wrong and the renderer's possibly-lagging broadcast state never enters into it. Plumbing: `CH.presTake` in `shared/types.ts`, `ipcMain.on` in `main/ipc.ts`, `take` on the `stateStore` sink, the preload bridge, and `HelmApi.presentation.take`.

**Non-goal.** The three existing hand-rolled guards — `SermonMode.goLiveFromBuilder:552`, `SongsMode.jumpSection:464`, `preserviceEngine.pushLive` — stay as they are. Converting them would change their fetch and IPC behavior, which is not this issue.

## 2. Delivery

Each presentational rail gains an `onActivate` prop mirroring its existing `onSelect`, wired to `onDoubleClick`. The rails stay presentational and decide nothing; the meaning stays in the mode, the shape `ChapterRail`'s own doc comment already describes.

Rows also get `userSelect: 'none'`. Double-clicking a `<button>` otherwise selects its label text, which would read as a glitch on every card in the app.

## 3. Per-surface mapping

| Surface | Double-click |
|---|---|
| `ChapterRail` verse row | `take(keyForScripture(book, ch, v), verseSlide)` |
| `SectionRail` section row | `take(keyForSong(id, i), slideFor(song, section))` |
| `ParagraphRail` paragraph row | `take(keyForMessageQuote(msgId, ord), quoteSlide)` |
| `SlidesTrack` media row / deck slide row | `take(keyForMedia(...), slide)` |
| `PreServiceMode` card | new engine method `takeCard(i)` — `pushLive` at an explicit index |
| `SongSearchRail` result | set active song, clear armed, then `take(keyForSong(id, i), …)` — `i` is 0, or the live section when the song is already live (#76: re-takes what is on screen instead of jumping to the top) |
| `MessageSearchRail` tape / quote row | select, then `take` on that quote (a tape takes ord 0) |
| `SchedulePanel` reading row | `jumpToReading`, resolve the chapter, `take` on the reading's `from` verse |

Consistency is the point. A double-click that works in one rail and not another is worse than none, because the operator learns to trust it.

`PreServiceMode` is the only surface whose work is not purely renderer-side: today's `showCard(i)` is navigate-only (`pushShow`, which refuses to start projecting), so taking the screen from a card needs a new engine method alongside it.

## 4. Secondary semantics

- **Already live.** No-op, decided in main. Not re-proved per surface. "No-op" means the *screen* is untouched — it never blacks. It does not mean the surface changes nothing: `PreServiceMode`'s `takeCard` stops the rotation unconditionally, the same halt `showNow` performs, because the operator pointed at that card and asked to hold it. Halting a rotation is not blacking, and the Loop control restarts it. Deriving the halt from "is this card already live?" cannot work either: a real double-click delivers click, click, dblclick, so the two `showCard`s have already made that card live before `takeCard` runs.
- **Songs' armed state.** The double-clicked song wins; arming clears. Committing what was double-clicked is the least surprising.
- **Shift-double-click.** `railSelect` is idempotent under a repeated shift-click on the same verse, so both clicks build the identical range. Then take on the range's start verse — the same single-verse slide Shift+Enter already produces via `goLiveWithChapter`.
- **The first click still fires.** No debounce. From black, click 1 only cues and click 2 takes, so nothing intermediate is visible. When already live in the same kind, click 1 *is* the take and click 2 is the no-op. A visible intermediate needs live-in-a-different-kind, where `sameKind` refuses click 1 anyway. Delaying every single click by 250ms to avoid that case would be the wrong trade in a live tool.
- **`blurOnPointerClick`.** Blurring the button does not reset the browser's click counter, so `dblclick` still dispatches. jsdom cannot prove this — `fireEvent.doubleClick` synthesizes the event directly — so it is verified in the real app, not claimed from a passing test.

## 5. Testing

- `shared/presentation/core.test.ts`: `takeLive` is idempotent on the live key, takes from black, and takes across kinds.
- One test per surface: double-click sends `take` with the expected key, and double-clicking an already-live card never lands on `output: 'black'`.
- Real-app verification for `blurOnPointerClick` delivery and for text selection on double-click.

## Acceptance

- Double-clicking a card on any of the eight surfaces puts it on screen.
- Double-clicking a card that is already live does nothing — it never blacks the projector.
- Single-click behavior is unchanged everywhere, including shift-click ranges — with one carved-out exception, approved as a trade rather than accepted as an accident: in the message track, a single click on a search row no longer clears the query. The auto-clear flipped `hasSearch` on the first click of the double-click, which unmounted the very row being double-clicked, so the second click landed on a different element and `dblclick` never dispatched. The gesture was impossible in a real browser (jsdom cannot see it — `fireEvent.doubleClick` synthesizes the event onto the node it is handed). The single click still selects the quote on the spot; only the results-clearing is gone, and the rail still returns to the QUOTE SCHEDULE view when the operator empties the box.
- Behavior is identical across all listed surfaces.
