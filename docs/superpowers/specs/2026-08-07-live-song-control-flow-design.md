# Live song control flow: center lock, armed switching, escape/search keys — design

Date: 2026-08-07
Status: approved (pending spec review)

## Problem

While a song is live, the operator's job is driving the live song's sections, and the
leader display must show the live song constantly. Today, selecting another song in the
Songs list breaks both:

- The operator's center (hero + section rail + verse hotkeys) switches to the selected
  song, detaching the controls from what's on screen — a verse change is lost until the
  operator finds their way back.
- The leader view follows the *cue* (`cuedKey ?? liveKey`), so browsing yanks the leader
  away from the song the congregation is singing.

Browsing for another song mid-song is rare; the flow must protect live control first and
make deliberate switching fast second.

## Goals

1. While output is live on a song, the operator's center is locked to the live song. No
   list interaction, search, or QuickAdd can detach it.
2. Clicking a different song while live **arms** it as next; **Enter** (or the Go-live
   button, relabeled) commits the switch — armed song goes live at its first section.
   Accidental clicks are harmless.
3. The leader view shows the live song whenever output is live; it follows the cued
   selection only when output is down (black/logo).
4. Escape progressively backs out: close modal → disarm → leave text field → take the
   screen to black.
5. `\` focuses the song search field (as a second default binding alongside `/`).

## Non-goals

- Changes to section navigation, Prev/Next, or go-live semantics within one song.
- Arming/locking in Sermon or Pre-service modes, or when live content is not a song.
- A delete/edit flow for songs (Edit remains a stub).
- Changes to audience/stage/livestream views.

## Design

### 1. Center lock + armed switching (SongsMode)

New state: `armedNextId: string | null`.

**Lock condition:** `output === 'live' && parseSongKey(liveKey) !== null`. Call the parsed
song id `liveSongId`.

**Click behavior (`selectSong` from the list):**
- Not locked → exactly today's behavior: select + section 0 (cue effect fires).
- Locked, clicked id === `liveSongId` → disarm (`armedNextId = null`); ensure the center
  is on the live song (select it if `activeSongId` somehow diverged).
- Locked, clicked id === `armedNextId` → disarm (toggle off).
- Locked, any other id → `armedNextId = id`. No selection change, no cue, no IPC.

**Commit (Enter via the `go.live` action, or the button):** when armed,
`goLive(keyForSong(armedNextId, 0), slideFor(armedSong, sections[0]))`, then select the
armed song (`activeSongId = armedNextId`, `section = 0`) and disarm. `goLive` already
records the cue, so leader and cued state stay consistent. When not armed, the button and
Enter keep today's go-live/take-down behavior.

**Button label:** armed → `⇄ Switch to <title>` (accent/green styling, distinct from
take-down red). Not armed → unchanged (`● Go live` / `■ Take down`).

**List row states:** the armed row gets a "NEXT" treatment (accent outline + NEXT badge in
the row), distinct from the active-row highlight. `SongRow` gains `isArmed: boolean`.

**Disarm triggers:** Escape (see §3), clicking the armed row, clicking the live song's
row, committing the switch, take-down (output leaves 'live'), and the lock condition
becoming false for any reason (e.g. scripture takes the screen). Implement the latter two
as: `armedNextId` is only meaningful while locked; when the lock condition is false the
UI ignores it and the next state change clears it (effect keyed on the lock condition).

**QuickAdd save while locked:** arm the new song instead of selecting it (library
refreshes so it appears in the list, armed). Not locked → today's behavior (select it).
The Edit stub keeps calling plain selection.

**Center binding while locked:** guarantee `activeSongId === liveSongId` by construction —
every path that changes `activeSongId` while locked is either the commit path (which
moves live first) or blocked (arming, QuickAdd). Add a reconciling effect: while locked,
if `activeSongId !== liveSongId` (e.g. song went live from elsewhere), select the live
song and clamp `section` to the live section index from `liveKey`. The section state
continues to drive cue/hot-update exactly as today.

### 2. Leader view tracks live-first

`LeaderView` shown key changes from `cuedKey ?? liveKey` to:

```
output === 'live' && liveKey ? liveKey : (cuedKey ?? liveKey)
```

While live: locked to the live song — browsing, arming, QuickAdd, and cross-kind cues
cannot move it. Output down: follows the cued selection (prep view), as today. Chip logic
is unchanged (LIVE when the shown key is live and output is live; CUED otherwise; plus
LOGO/BLACK chips).

### 3. Escape chain (Songs mode key handler)

`onEscape`, in order:
1. Modal open (QuickAdd / Import) → close it (existing behavior, unchanged).
2. `armedNextId` set → disarm, handled.
3. Focus is in an input/textarea → blur it, handled.
4. `output === 'live'` → `presentation.setOutput('black')` (unconditional take-down),
   handled.
5. Otherwise → unhandled (existing App fallthrough).

Note: the key dispatcher routes Escape to the mode handler even while typing — step 3
must come after disarm so an armed state is undone before field blur, and before
take-down so typing operators never black the screen with a stray Escape.

### 4. `\` focuses search

`focus.search` action defaults become `['/', '\\']`. The action is already rebindable and
already routed to the Songs search input; the dispatcher's typing guard keeps `\` typed
inside a field from firing it.

## Error handling

- Armed song deleted/missing at commit time (library refreshed): commit is a no-op that
  disarms.
- `liveKey` pointing at a song not in the library (deleted while live): lock condition
  still true but reconciliation can't select it — center falls back to unlocked behavior
  (no crash; hero shows the selected song); leader already falls back to SlidesView.
- Take-down via Escape while armed: Escape disarms first (step 2); a second Escape takes
  the screen down (step 4). Deliberate: one key, one action.

## Testing

- SongsMode unit tests: click while locked arms without cueing (no `presentation.cue`
  call, `activeSongId` unchanged); click on armed/live rows disarms; Enter commits
  (goLive called with armed key, selection follows, disarm); QuickAdd save arms while
  locked and selects while not; not-locked clicks behave as before.
- LeaderView tests: live-first shown key (browsing/cue changes while live don't move it;
  follows cue when output black); existing cue-follow tests updated to output-down states.
- Escape chain tests: each step in order, including armed-before-blur and
  typing-never-takes-down.
- Hotkey test: `focus.search` defaults include `\`.
- Live driver pass: arm → switch flow on the real app; leader stability while browsing.
