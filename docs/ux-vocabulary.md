# Helm operator vocabulary

The companion to `docs/ux-grammar.md`. The grammar says how operator controls behave;
this file says what they are called. Use these words, with these meanings, on every page:
Pre-service, Songs, and Sermon with its Scripture, Message and Slides tracks. Anything not
listed here is a page noun: section (Songs), verse and reading (Scripture), paragraph and
quote (Message), slide (Slides), card (Pre-service).

Decided by Chase on 2026-10-11. Where a word is decided but the code does not use it yet,
the "Status" line under the table says which change delivers it.

## The ten words

| Word | Means | Where it appears | Retired |
|---|---|---|---|
| **Live** | The congregation sees this now. Always red (`T.live`). When another page owns the screen, the page chip says `LIVE FROM SONGS`, `LIVE FROM SERMON` or `LIVE FROM PRE-SERVICE`, in faint (`T.faint`), never red: the Header already carries the red. | Row badges (`LIVE`), page status chip (`LIVE ON SCREEN`), Header chip | PROJECTING, ON SCREEN as a badge, ANOTHER FLOW LIVE |
| **Cued** | Selected and previewed: what Go live would put up. | Row badges (`CUED`), hero ring | ARMED |
| **Queued** | Something lined up behind what is live, waiting for Go live. | `QUEUED` badge on Songs, Slides, Message and the Scripture schedule | NEXT and NEXT? as badges |
| **Up next** | The item after the cued one, in sequence. | The on-deck strip (`UP NEXT`) | "Cue next", "TAP OR PRESS" |
| **Go live** | Put the cued thing on screen. Green (`T.go`), right-most slot. | Button, Enter (Shortcuts label `Go live`), double-click | "Go live / take down" |
| **Take down** | Black the audience screen. Fixed slot beside Go live. Tooltip on every page: "Black the audience screen". | Button, Header chip (`TAKE DOWN`), last Escape rung | "Clear the audience screen" |
| **Nothing on screen** | Output is black. | Page status chip, Header chip, leader view, the ghosted Take down tooltip | SCREEN BLACK, OFF SCREEN, BLACK |
| **Add** | File one thing the operator typed or picked into this page's list or library. | `+ Add ...` buttons; the save button of a create modal (`Add to library`, `Add to loop`) | "Save to library" on create |
| **Import** | Bring things in from a file or another program. Always with `+`. | `+ Import`, `+ Import a song library` | Import without the `+` |
| **Delete** | Take something out of a list. In-service lists delete at once and show `Deleted <thing>` with Undo for five seconds. Libraries (songs, media) ask for a confirm click instead and have no undo. | Context menu (`Delete`, `Delete 3 verses`), toast, card editor (`Delete card`), song library (`Delete from library`, then `Really delete?`), Shortcuts (`Delete selected`), Clear all tooltip | Remove, Removed |

Status: the `QUEUED` badge (decision 7), the Scripture schedule's cue-only click
(decision 3) and the media library's confirm (decision 2) are delivered by separate
changes. Until they land, Songs still shows `NEXT`, a Scripture schedule click still moves
the live cursor, and the media library still uses the in-service undo.

## Supporting words

- **‹ Previous** and **Next ›**: the step buttons, identical on every page. The unit goes in
  the tooltip only: "Previous section", "Next verse", "Next paragraph", "Next slide",
  "Next card". Retired: `‹ Back`, `‹ Prev`, `Cue next ›`, `Next verse ›`, bare `‹` and `›`.
- **Click, double-click, Shift-click**: operator copy never says tap.
- **Schedule**: this Sunday's list on a page. **Library**: every Sunday's store
  (`SONG LIBRARY`).
- **Edit** opens an item's editor; **Save changes** commits an edit; **Undo** reverses a
  delete.
- **Clear** empties a field or a list (`Clear field`, `Clear all`). It never means the
  screen; that is Take down.
- **Release / take back screens**: hand every output to other apps and back
  (Shortcuts label; the button says "Take the screens back").
- **Page names** are the Header tab names: Pre-service, Songs, Sermon. Tracks are named
  after the page: "Sermon page · Scripture track". Status chips use them in capitals.

## The rail hint sentence

Every rail that explains its gestures uses one sentence, built by `railHint()` in
`src/renderer/operator/railHints.ts`, with only the noun changing:

> Click a *verse* to cue it; while it's live the screen follows. Double-click to go live.

Where the rail selects ranges it adds "Shift-click to select a range." (the verse rail
says "build a range", because its range goes into the reference builder). The Scripture
schedule never moves the screen on a single click (decision 3), so its hint drops the
follow clause: "Click a reading to cue it. Double-click to go live. Shift-click to select
a range."

## Fixed messages

- No Bible installed: "Install a Bible in Settings → Bibles" (`INSTALL_HINT`,
  `src/shared/scripture/labels.ts`), everywhere it is needed.
- Empty lists name the control that fills them in bold (grammar rule 7).

## Allowed per-page differences

Each is visible on the surface, so the operator is never surprised.

- **Songs queues** a different song while one is live (`QUEUED`); **Scripture's verse
  cursor follows** across chapters while live. Both are stated in their rail hints.
- **Pre-service** has the loop: `Start loop` / `Stop loop`, `Show this card`, the dwell
  control, and `IN LOOP` / `SKIPPED` instead of "planned". Where `Start loop` sits in the
  row is decision 4, still open.
- **Libraries confirm** (songs, and media once decision 2 lands).
- **Page tools**: chorus / bridge / tag jumps (Songs), the translation picker (Scripture),
  the tape player and `Follow along ›` (Message), video Play / Pause / Mute (Slides).
