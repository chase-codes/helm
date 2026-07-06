# Pre-service Bible verse look-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Look up" affordance to the pre-service verse card editor that pulls real verse text from the primary installed Bible (via existing IPC) and stores `ref` + `text` + `version` on the card, keeping the render path unchanged.

**Architecture:** Edit-time resolution (denormalized). A new pure helper extracts one verse's text from a fetched `ChapterData`. The editor orchestrates `parseRef` → `bibles.manifest()` → `bibles.getChapter()` → the helper, all in the renderer using **existing** IPC — no main/preload changes. A new optional `PreCard.version` field carries the translation abbreviation to the projected slide; manual authoring is untouched and falls back to the `KJV` label.

**Tech Stack:** TypeScript, Electron (renderer-only for this slice), React, Vitest, `@testing-library/react`.

## Global Constraints

- **Reuse existing IPC only:** resolution uses `window.helm.bibles.manifest()` (returns `BibleManifestEntry[]` with `id`, `abbr`, `installed`) and `window.helm.bibles.getChapter(book, chapter)` (returns `ChapterData` with `verses: Record<number, Record<versionId, string>>`). **No changes to `src/main/**` or `src/preload/**`.**
- **Primary Bible** = `manifest.find(m => m.installed)` (first installed), matching the convention `bibles:bookExtent` already uses.
- **Single verse only:** a parsed range (`parsed.from !== parsed.to`) is rejected with a message; fields are not modified.
- **Backward compatible:** `version` is a new optional field. Existing/hand-authored verse cards render with the `'KJV'` fallback label. No DB migration.
- **Gate (per task commit):** `npm run typecheck` clean; `npm test` all pass; `npx eslint .` → 0 new errors (~3200 pre-existing prettier warnings are fine). **`npm test` needs no better-sqlite3 rebuild** — main-process tests run on `node:sqlite` via `openTestDb()`.
- **Copy strings (verbatim), used by the editor and its tests:**
  - unparseable ref → `Enter a reference like Psalm 122:1`
  - range → `Enter a single verse, e.g. James 1:1`
  - no Bible → `Install a Bible first (Settings → Bibles)`
  - verse absent → `` `${parsed.book} ${parsed.ch} has no verse ${parsed.from} in ${primary.abbr}` `` (e.g. `Psalm 122 has no verse 9 in KJV`)
  - success → `` `✓ ${primary.abbr}` `` (e.g. `✓ KJV`)

---

### Task 1: Pure verse-text resolver

**Files:**
- Create: `src/shared/scripture/preVerse.ts`
- Test: `src/shared/scripture/preVerse.test.ts`

**Interfaces:**
- Consumes: `ChapterData` from `../types`.
- Produces: `verseText(chapter: ChapterData, verse: number, versionId: string): string | null` — the text for that verse+version, or `null` if absent. Consumed by Task 3.

- [ ] **Step 1: Write the failing test**

Create `src/shared/scripture/preVerse.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { verseText } from './preVerse';
import type { ChapterData } from '../types';

const chapter: ChapterData = {
  book: 'Psalm',
  chapter: 122,
  verseCount: 2,
  verses: { 1: { kjv: 'I was glad…' }, 2: { kjv: 'Our feet shall stand…' } }
};

describe('verseText', () => {
  it('returns the verse text for a present verse + version', () => {
    expect(verseText(chapter, 1, 'kjv')).toBe('I was glad…');
  });
  it('returns null when the verse number is absent', () => {
    expect(verseText(chapter, 9, 'kjv')).toBeNull();
  });
  it('returns null when the version is absent for that verse', () => {
    expect(verseText(chapter, 1, 'web')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/shared/scripture/preVerse.test.ts`
Expected: FAIL — `verseText` / module not found.

- [ ] **Step 3: Write the implementation**

Create `src/shared/scripture/preVerse.ts`:

```ts
import type { ChapterData } from '../types';

// Extract a single verse's text for one version from a fetched chapter. Returns null
// when the verse number (or that version's text for it) is absent — the editor turns
// that into a "verse not found" message. Pure and unit-tested; the IPC fetch lives in
// the caller (PreCardEditor).
export function verseText(chapter: ChapterData, verse: number, versionId: string): string | null {
  return chapter.verses[verse]?.[versionId] ?? null;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/shared/scripture/preVerse.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/shared/scripture/preVerse.ts src/shared/scripture/preVerse.test.ts
git commit -m "feat(scripture): pure verseText resolver for pre-service look-up"
```

---

### Task 2: `version` field — persist and render

**Files:**
- Modify: `src/shared/types.ts:29` (PreCard verse fields)
- Modify: `src/main/preCardsRepo.ts:6` (PAYLOAD_KEYS)
- Modify: `src/shared/preservice/cards.ts:10` (preSlideFor verse case)
- Test: `src/shared/preservice/cards.test.ts`, `src/main/preCardsRepo.test.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PreCard.version?: string` — the translation abbreviation on a verse card; persisted by `preCardsRepo`, read by `preSlideFor` as the scripture column's version label. Consumed by Task 3.

- [ ] **Step 1: Write the failing tests**

In `src/shared/preservice/cards.test.ts`, add a test after the existing `'verse → scripture slide (KJV single column)'` test (the existing one stays — it documents the no-version fallback):

```ts
  it('verse card with a version uses it as the column label', () => {
    expect(preSlideFor({ ...base, type: 'verse', ref: 'John 3:16', text: 'For God…', version: 'WEB' } as PreCard))
      .toEqual({ kind: 'scripture', accent: '#6f9cf0', ref: 'John 3:16', label: 'John 3:16', columns: [{ version: 'WEB', text: 'For God…' }] });
  });
```

In `src/main/preCardsRepo.test.ts`, add inside `describe('preCardsRepo', …)`:

```ts
  it('persists the version field on a verse card', () => {
    const repo = freshRepo();
    const after = repo.save({ type: 'verse', title: 'John 3:16', ref: 'John 3:16', text: 'For God…', version: 'WEB', enabled: true });
    expect(after.find((c) => c.ref === 'John 3:16')?.version).toBe('WEB');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/shared/preservice/cards.test.ts src/main/preCardsRepo.test.ts`
Expected: FAIL — `cards.test` gets `version: 'KJV'` instead of `'WEB'` (hardcoded); `preCardsRepo.test` gets `undefined` (field not in PAYLOAD_KEYS); TypeScript may also flag `version` as not a `PreCard` key.

- [ ] **Step 3: Add the field to the type**

In `src/shared/types.ts`, change the `PreCard` verse-fields line (currently line 29):

```ts
  ref?: string; text?: string; version?: string;   // verse
```

- [ ] **Step 4: Persist the field in the repo**

In `src/main/preCardsRepo.ts` line 6, add `'version'` to `PAYLOAD_KEYS`:

```ts
const PAYLOAD_KEYS = ['headline', 'subtitle', 'ref', 'text', 'version', 'points', 'src'] as const;
```

(`payloadOf` iterates these keys and `toCard` spreads the parsed payload, so the field round-trips with no further change.)

- [ ] **Step 5: Render the field as the column label**

In `src/shared/preservice/cards.ts` line 10, change the verse case's hardcoded version:

```ts
    case 'verse':
      return { kind: 'scripture', accent: '#6f9cf0', ref: card.ref || '', label: card.ref || '', columns: [{ version: card.version || 'KJV', text: card.text || '' }] };
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run src/shared/preservice/cards.test.ts src/main/preCardsRepo.test.ts`
Expected: PASS (including the existing no-version test, which still gets the `'KJV'` fallback).

- [ ] **Step 7: Commit**

```bash
git add src/shared/types.ts src/main/preCardsRepo.ts src/shared/preservice/cards.ts \
        src/shared/preservice/cards.test.ts src/main/preCardsRepo.test.ts
git commit -m "feat(preservice): store + render verse card translation label"
```

---

### Task 3: Editor look-up + UI + verification

**Files:**
- Modify: `src/renderer/operator/PreCardEditor.tsx`
- Create: `src/renderer/operator/PreCardEditor.test.tsx`
- Modify: `README.md` (one pre-service line)

**Interfaces:**
- Consumes: `verseText` (Task 1); `PreCard.version` (Task 2); `parseRef`/`formatRef` from `../../shared/scripture/refs`; `window.helm.bibles.manifest()` / `window.helm.bibles.getChapter(book, ch)`; `window.helm.preservice.saveCard(...)`.
- Produces: the finished feature — no downstream consumers.

- [ ] **Step 1: Write the failing editor tests**

Create `src/renderer/operator/PreCardEditor.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PreCardEditor } from './PreCardEditor'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'
import type { BibleManifestEntry, ChapterData } from '../../shared/types'

afterEach(cleanup)

const KJV: BibleManifestEntry = { id: 'kjv', abbr: 'KJV', name: 'King James', installed: true }
const PS122: ChapterData = {
  book: 'Psalm', chapter: 122, verseCount: 2,
  verses: { 1: { kjv: 'I was glad when they said unto me' }, 2: { kjv: 'Our feet shall stand' } }
}

function installHelm(over: {
  manifest?: BibleManifestEntry[]
  getChapter?: (book: string, ch: number) => Promise<ChapterData>
} = {}): { saveCard: ReturnType<typeof vi.fn> } {
  const saveCard = vi.fn()
  ;(window as unknown as { helm: unknown }).helm = {
    preservice: { saveCard, removeCard: vi.fn() },
    bibles: {
      manifest: () => Promise.resolve(over.manifest ?? [KJV]),
      getChapter: over.getChapter ?? (() => Promise.resolve(PS122))
    }
  }
  return { saveCard }
}

function renderEditor(): void {
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <PreCardEditor card={null} onClose={() => {}} />
    </ThemeCtx.Provider>
  )
}

async function lookUp(ref: string): Promise<void> {
  const refInput = screen.getByPlaceholderText('Psalm 122:1') as HTMLInputElement
  fireEvent.change(refInput, { target: { value: ref } })
  fireEvent.click(screen.getByText('Look up'))
}

describe('PreCardEditor verse look-up', () => {
  it('fills verse text, canonicalizes the reference, and shows the version', async () => {
    installHelm()
    renderEditor()
    await lookUp('psalm 122:1')
    const textArea = await screen.findByPlaceholderText('I was glad when they said unto me…') as HTMLTextAreaElement
    await waitFor(() => expect(textArea.value).toBe('I was glad when they said unto me'))
    expect((screen.getByPlaceholderText('Psalm 122:1') as HTMLInputElement).value).toBe('Psalm 122:1')
    expect(screen.getByText('✓ KJV')).toBeTruthy()
  })

  it('rejects a range and leaves the fields unchanged', async () => {
    installHelm()
    renderEditor()
    await lookUp('psalm 122:1-2')
    expect(await screen.findByText('Enter a single verse, e.g. James 1:1')).toBeTruthy()
    expect((screen.getByPlaceholderText('I was glad when they said unto me…') as HTMLTextAreaElement).value).toBe('')
  })

  it('shows a message when no Bible is installed', async () => {
    installHelm({ manifest: [] })
    renderEditor()
    await lookUp('psalm 122:1')
    expect(await screen.findByText('Install a Bible first (Settings → Bibles)')).toBeTruthy()
  })

  it('shows a message when the verse is absent from the chapter', async () => {
    installHelm()
    renderEditor()
    await lookUp('psalm 122:9')
    expect(await screen.findByText('Psalm 122 has no verse 9 in KJV')).toBeTruthy()
  })

  it('saves a hand-typed verse card with no version', async () => {
    const { saveCard } = installHelm()
    renderEditor()
    fireEvent.change(screen.getByPlaceholderText('Psalm 122:1'), { target: { value: 'Acts 2:38' } })
    fireEvent.change(screen.getByPlaceholderText('I was glad when they said unto me…'), { target: { value: 'Repent…' } })
    fireEvent.click(screen.getByText('Add to loop'))
    expect(saveCard).toHaveBeenCalledWith(expect.objectContaining({ type: 'verse', ref: 'Acts 2:38', text: 'Repent…' }))
    expect(saveCard.mock.calls[0][0].version).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/operator/PreCardEditor.test.tsx`
Expected: FAIL — there is no `Look up` button yet (`getByText('Look up')` throws).

- [ ] **Step 3: Add imports and look-up state/handler**

In `src/renderer/operator/PreCardEditor.tsx`, add these imports below the existing ones (after the `import type { PreCard, PreCardType }` line):

```ts
import { parseRef, formatRef } from '../../shared/scripture/refs';
import { verseText } from '../../shared/scripture/preVerse';
```

Inside the component, add state next to the other `useState` calls (after `peSubtitle`):

```ts
  const [version, setVersion] = useState<string | undefined>(card?.version);
  const [lookupMsg, setLookupMsg] = useState('');
```

Add the handler above `save` (near the `stop` helper):

```ts
  const lookUp = async (): Promise<void> => {
    const parsed = parseRef(peRef);
    if (!parsed) { setLookupMsg('Enter a reference like Psalm 122:1'); return; }
    if (parsed.from !== parsed.to) { setLookupMsg('Enter a single verse, e.g. James 1:1'); return; }
    const manifest = await window.helm.bibles.manifest();
    const primary = manifest.find((m) => m.installed);
    if (!primary) { setLookupMsg('Install a Bible first (Settings → Bibles)'); return; }
    const chapter = await window.helm.bibles.getChapter(parsed.book, parsed.ch);
    const text = verseText(chapter, parsed.from, primary.id);
    if (text == null) { setLookupMsg(`${parsed.book} ${parsed.ch} has no verse ${parsed.from} in ${primary.abbr}`); return; }
    setPeRef(formatRef(parsed));
    setPeText(text);
    setVersion(primary.abbr);
    setLookupMsg(`✓ ${primary.abbr}`);
  };
```

- [ ] **Step 4: Persist `version` on save**

In the same file, in `save()`, change the `peType === 'verse'` branch to include `version`:

```ts
    if (peType === 'verse') {
      window.helm.preservice.saveCard({
        id: card?.id,
        type: 'verse',
        enabled,
        title: peTitle.trim() || peRef.trim() || 'Verse',
        ref: peRef.trim(),
        text: peText.trim(),
        version
      });
    } else if (peType === 'list') {
```

- [ ] **Step 5: Add the Look-up button + message to the verse tab**

Add a style constant with the other styles (after `smallGhost`):

```ts
  const lookupBtnStyle: CSSProperties = {
    height: '38px',
    padding: '0 14px',
    borderRadius: '9px',
    background: T.panel2,
    boxShadow: `inset 0 0 0 1px ${T.border}`,
    fontSize: '12.5px',
    fontWeight: 600,
    color: T.dim,
    flexShrink: 0
  };
  const lookupMsgStyle: CSSProperties = { fontSize: '11.5px', color: T.dim, marginTop: '6px' };
```

Replace the verse tab's `REFERENCE` field block (currently the `<div>` wrapping the reference `<input>`) with:

```tsx
              <div>
                <div style={fieldLabelStyle}>REFERENCE</div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    style={{ ...inputStyle, flex: 1 }}
                    value={peRef}
                    onChange={(e) => setPeRef(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void lookUp();
                      }
                    }}
                    placeholder="Psalm 122:1"
                  />
                  <button style={lookupBtnStyle} onClick={() => void lookUp()}>
                    Look up
                  </button>
                </div>
                {lookupMsg && <div style={lookupMsgStyle}>{lookupMsg}</div>}
              </div>
```

(The `VERSE TEXT` textarea directly below is unchanged — both fields stay editable.)

- [ ] **Step 6: Run the editor tests to verify they pass**

Run: `npx vitest run src/renderer/operator/PreCardEditor.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 7: Update the README pre-service line**

In `README.md`, in the Status paragraph's Slice 5 sentence, extend the pre-service description so verse look-up is mentioned. Change:

```
announcements / prayer / logo card set on a dwell timer, engaged and taken live from the
operator's Pre-Service tab.
```

to:

```
announcements / prayer / logo card set on a dwell timer, engaged and taken live from the
operator's Pre-Service tab; verse cards can pull their text from the installed Bible by
reference. 
```

- [ ] **Step 8: Full gate**

```bash
npm run typecheck
npm test
npx eslint .
```
Expected: typecheck clean; all tests pass (no better-sqlite3 rebuild needed); eslint 0 errors. Fix before continuing if any fail.

- [ ] **Step 9: Verify in the running app**

Build and drive the app (macOS; reuse the Playwright `_electron` driver pattern from the earlier run — `node_modules/electron/dist/Electron.app/Contents/MacOS/Electron`, `--no-sandbox`, cwd = repo root). If the app fails to launch with a `NODE_MODULE_VERSION` error, run `npx electron-rebuild -f -w better-sqlite3` first (the app needs better-sqlite3 on Electron's ABI). Then:
1. `npx electron-vite build`
2. Launch, go to the **Pre-service** tab, click **+ Add a card**, ensure the **Bible verse** tab is selected.
3. Type `john 3:16` in REFERENCE, click **Look up** → the VERSE TEXT fills with the KJV text, the reference canonicalizes to `John 3:16`, and `✓ KJV` shows. Screenshot it.
4. **Add to loop**, then engage the loop and confirm the verse projects with the `KJV` label.

Confirm the screenshot shows the filled verse text (a blank frame = launch failure, not success).

- [ ] **Step 10: Commit**

```bash
git add src/renderer/operator/PreCardEditor.tsx src/renderer/operator/PreCardEditor.test.tsx README.md
git commit -m "feat(preservice): look up verse text from the installed Bible in the card editor"
```

- [ ] **Step 11: Log to the build progress file** (gitignored — do not `git add`)

Append one line to `.superpowers/sdd/progress.md`, e.g.:
```
Pre-service verse look-up: complete (commits <sha1>..<sha3>, gate green: typecheck clean, all tests pass, lint 0 errors; app-verified John 3:16 look-up fills KJV text + projects). Realizes the Slice 5 deferred "verse card pulls from installed bible" note in edit-time form: new PreCard.version field, pure verseText resolver, PreCardEditor Look up (reuses bibles.manifest/getChapter — no main/preload change). Single verse only; manual authoring unchanged (KJV fallback).
```

---

## Self-Review

**Spec coverage** (against the design's §4):
- §4.1 Types (`PreCard.version`) — Task 2 Step 3. ✅
- §4.2 Shared resolver — Task 1 (`verseText`); `slides.ts` reuse considered and rejected (returns columns + needs `abbrOf`; a focused helper is cleaner). ✅
- §4.3 Repo (`PAYLOAD_KEYS`) — Task 2 Step 4. ✅
- §4.4 Slide render label — Task 2 Step 5. ✅
- §4.5 Editor look-up (button, Enter, handler, errors, save `version`) — Task 3 Steps 3–5. ✅
- §5 Testing — resolver (T1), slide label (T2), repo round-trip (T2), editor look-up/range/no-Bible/not-found/manual (T3). ✅
- §3 behavioral end state — every message string is in Global Constraints and asserted in Task 3 tests; app verification in Task 3 Step 9. ✅

**Placeholder scan:** every code step shows complete code; no TBD/"handle errors" — the exact five copy strings are fixed in Global Constraints and reused verbatim.

**Type consistency:** `verseText(chapter, verse, versionId): string | null` is identical in Task 1's definition, its test, and Task 3's call. `PreCard.version?: string` is the same in the type (T2), the repo key (T2), `preSlideFor` (T2), and the editor's `saveCard`/state (T3). `parseRef` returns `{ book, ch, from, to }` — the handler uses `parsed.book`, `parsed.ch`, `parsed.from`, `parsed.to`, matching `refs.ts`. Message interpolation uses `parsed.book`/`parsed.ch`/`parsed.from`/`primary.abbr`, and the test's expected string (`Psalm 122 has no verse 9 in KJV`) matches (`parseRef('psalm 122:9').book === 'Psalm'`).

**Note on book canonicalization (verified):** `parseRef('psalm 122:9').book === 'Psalm'` and `parseRef('john 3:16').book === 'John'` (confirmed against `books.ts` — the canonical name is `Psalm`, singular). The not-found test string (`Psalm 122 has no verse 9 in KJV`) and the canonicalized-reference assertion (`Psalm 122:1`) are correct as written; no re-checking needed.
