# Helm

A Mac + Windows desktop app for running a church service from one seat: congregational
songs and scripture (sermon quotes and a pre-service loop are planned but not yet built) —
searched by half-remembered lyric or typed reference, cued and taken live from an operator
console, and projected full-screen to a second display over HDMI. Everything is stored
locally in SQLite; the operator window and the physical output are both pure renders of
one shared presentation state, so what you see in the preview is exactly what the room
sees. See `docs/superpowers/specs/2026-07-03-helm-design.md` §1 for the full purpose and
success criteria.

**Status:** slice 1–2 (songs mode), slice 3 (scripture), and slice 4 (the Message track)
are implemented — song search, cue, go-live, quick-add, keyboard control, resizable panels,
auto-attaching output window; scripture reference parsing, bundled KJV plus an in-app Bible
installer, sermon-mode scripture track with chapter rail and translation compare; and the
Message track — William Branham sermon "tapes" with full-text offline search (tape search,
quote search, search-within-a-tape), quote slides, a tape audio player, and a scrolling
follow-along reading view. The pre-service loop and multi-display roles are deferred to
later slices (spec §11).

**Message track — acquisition & audio (spec `docs/superpowers/specs/2026-07-03-helm-slice-4-message-design.md`).**
Sermon text and audio come from Voice of God Recordings' official distribution only.
Text installs in full (small, fully searchable offline); audio (`.m4a`) is downloaded
**on demand** and cached in the app-data `library/` folder — never a bulk pre-download.
**Local import** (Settings → Message → Import) is the other authoritative path: `.txt`
and `.pdf` transcripts the church already has are parsed into tape number / title / date /
numbered paragraphs, with an operator review screen before save. Two follow-ups are
noted in `docs/superpowers/notes/2026-07-03-the-table-acquisition.md`: the live branham.org
downloader (**4a** — the source is scrape-based, so the in-app "Install corpus" button is
wired but not yet functional) and hands-free audio↔text sync for the reading view via
forced alignment (**4b** — until then the reading view renders but does not auto-scroll).

## Project setup

```bash
npm install
```

## Development

```bash
npm run dev          # launch the app (operator window + on-demand output window)
npm test              # vitest, run once
npm run test:watch    # vitest, watch mode
npm run typecheck     # tsc --noEmit for both main/preload and renderer configs
npm run lint           # eslint
```

### `better-sqlite3` and Electron's ABI

`better-sqlite3` is a native module and must be compiled against whichever Node ABI is
currently running it. `npm test` runs under plain Node, but `npm run dev` and any packaged
build run under Electron's own (different) Node ABI. Switch between them as needed:

```bash
# Before npm test (plain Node ABI):
npm rebuild better-sqlite3

# Before npm run dev / packaging (Electron's ABI):
npx electron-rebuild -f -w better-sqlite3
# (equivalent to `npm run postinstall`, which runs electron-builder install-app-deps)
```

If `better-sqlite3` throws a "was compiled against a different Node.js version" error,
you're on the wrong ABI for what you just ran — rebuild for the other side.

## Build / package (smoke only — see spec §11, cross-platform installers are a later slice)

```bash
npm run build && npx electron-builder --dir   # unpacked app in dist/
```

## Architecture

- **Spec:** `docs/superpowers/specs/2026-07-03-helm-design.md` — purpose, success
  criteria, process layout, presentation-state model, data model.
- **Plan / build log:** `.superpowers/sdd/` — per-task briefs and reports for how the
  spec was implemented, plus `progress.md` for a one-line-per-task summary of what
  shipped and what was deferred.
- **Design source:** `docs/design/` — the vendored prototype (`Lectern.pretty.html`,
  `Lectern.dc.html`, `SlideCanvas.dc.html`) that the operator UI and output rendering
  are ported from pixel-for-pixel.

In brief: the **main process** owns the SQLite database and the single source of truth
for presentation state (what's cued, what's live) behind typed IPC. The **operator
window** is the console — search, cue, go-live. **Output windows** are frameless,
per-display renders of that same state; they hold no local state of their own.

## Sunday quickstart

1. Plug in the projector — before or after launching Helm, doesn't matter. The output
   window attaches to it automatically.
2. Launch Helm (`npm run dev`, or the packaged app).
3. Songs tab → type a few words of the lyric → **Enter** to cue → **Go live** (or press
   Enter/Space again) to put it on screen.
4. Sermon tab → type a reference — `john 3:16` — and press **Enter** to put it on screen
   immediately. Settings → Bibles has KJV installed out of the box; install more
   translations there (needs a network connection) to compare versions side by side.
5. Message tab → search a tape (or a quote by phrase), pick a paragraph, **Go live** to
   put the quote on screen. To play a tape, press ▶ on the player card (audio downloads
   and caches on first play). Load tapes ahead of time via Settings → Message → Import
   (`.txt`/`.pdf`) — review the parsed paragraphs, then save.
