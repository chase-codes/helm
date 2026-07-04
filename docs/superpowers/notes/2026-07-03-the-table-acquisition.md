# Spike: The Table acquisition format — findings & decision

**Date:** 2026-07-03
**Task:** Slice 4, Task 1 (spike). Blocks only the timing-provider choice; the rest of the slice is unaffected.

## What we needed
A machine-consumable, authoritative source for per-sermon **text (paragraph-numbered)**, **audio**, and **audio→paragraph sync timing**, to drive: full-text offline search, quote slides, on-demand audio, and the automatic follow-along reading view.

## Findings (verified 2026-07-03)

1. **Text — authoritative, per-sermon PDF transcripts.** branham.org publishes per-sermon PDF transcripts (paragraph-numbered — the canonical citation form). Reachable from each sermon's page. This **converges with our local-import parser**: fetch the authoritative PDF, extract text, run `parseMessageText` (Task 3) — the same pipeline a church uses to import its own files. There is also a legacy Folio full-text infobase (`om_isapi.dll?infobase=the_message.nfo`), not needed.

2. **Audio — authoritative, per-sermon `.m4a` (AAC) on CloudFront.** Pattern: `https://d21kl6o5a7faj0.cloudfront.net/repo/<hash>.m4a`. The `<hash>` is **not** tape-number-predictable; it is discovered by fetching the sermon's page (`https://branham.org/en/messagestream/ENG=<tapeNo>`). So audio acquisition = scrape sermon page → resolve `.m4a` URL → download → cache. **Format is `.m4a`, not `.mp3`** (HTML5 `<audio>` plays AAC natively — no code impact beyond the file extension/mime).

3. **Sync timing — only inside The Table SPA's internal API.** `table.branham.org` is a hash-routed SPA (`/#/en/main`); its Read-Along sentence timing is served by an **undocumented internal API**. It is not cleanly or legitimately bulk-fetchable. Reverse-engineering VGR's app API for bulk extraction is exactly the non-sanctioned use the "authoritative only" rule exists to avoid. **No clean authoritative timing source exists.**

## Decision

- **Text & audio → authoritative acquisition ships in slice 4.** `MessageSource` fetches the sermon index, per-sermon PDF text (→ `parseMessageText`), and resolves the `.m4a` URL per sermon (on demand). Acquisition automates the same user-facing downloads the church already uses; keep it **rate-limited and polite** (1,206 sermons).
- **Automatic sync timing → aeneas forced alignment, deferred to slice 4b.** The only automatic path is to compute paragraph timings locally from authoritative audio + text (aeneas: DTW + eSpeak, offline). That requires cross-platform native bundling (ffmpeg + eSpeak, Mac + Windows) + a per-tape alignment step — a slice's worth of work. Slice 4 ships the reading-view **renderer** and the `TimingMap` plumbing (operator-drivable); slice 4b computes timings and wires hands-free audio-driven scroll.
  - *Status: chosen as "Option A (split)" on 2026-07-03 while the user was away; consistent with the approved spec §3.1 and plan Task 1 Step 2. Flagged for user confirmation.*

## Locked `MessageSource` contract (refined for the findings above)

> Refinement vs. the plan's Task 1 draft: `audioUrl` is **async** (resolving the `.m4a` hash requires fetching the sermon page), and `timing` is `[]` in slice 4 (aeneas fills it in 4b).

```ts
export interface SermonIndexEntry { id: string; tapeNo: string; title: string; date: string; durationS: number }
export interface SermonPayload {
  paragraphs: { label: string; text: string }[]; // from the authoritative PDF via parseMessageText
  timing: { ord: number; tStart: number; tEnd: number }[]; // [] in slice 4; computed by aeneas in 4b
}
export interface MessageSource {
  fetchIndex(): Promise<SermonIndexEntry[]>;
  fetchSermon(id: string): Promise<SermonPayload>;
  audioUrl(entry: SermonIndexEntry): Promise<string>; // scrape sermon page → CloudFront .m4a URL
}
```

## Fixtures
- `src/main/__fixtures__/message-index.sample.json` — representative `SermonIndexEntry[]` (structure only; live index verified when `MessageSource` lands).
- `src/main/__fixtures__/message-sermon.sample.json` — representative `SermonPayload` (paragraph labels incl. `E-1`; `timing: []`).

These back Task 7's normalizer/adapter unit tests. They are **structural** fixtures — the live scrape/format is verified at `MessageSource` implementation and again in the manual gate.

## Plan deltas to carry into later tasks (not blocking Tasks 2–6)
- Task 7 (`MessageSource`): implement per the refined contract above; `fetchSermon` = fetch sermon page → PDF → `parseMessageText`; `audioUrl` async via page scrape; be polite/rate-limited.
- Task 8 (`messageInstaller`): audio file is `.m4a`; `downloadAudio` writes `library/<tapeNo>.m4a`.
- Reading view / Task 12: in slice 4, `timing` is `[]` → the reading view renders and is operator-drivable; hands-free audio sync arrives in 4b. Do not block the player on timing presence.
