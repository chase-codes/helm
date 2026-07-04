import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import type { ModeKeyHandlerRef, ThemeMode } from './App';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState } from './useHelm';
import { formatRef, matchBook, parseRef, type ParsedRef } from '../../shared/scripture/refs';
import { buildScriptureSlide, keyForScripture, pickVersion, verseCols } from '../../shared/scripture/slides';
import { norm } from '../../shared/search/fuzzy';
import type { BibleManifestEntry, ChapterData, ScriptureReading } from '../../shared/types';
import { SchedulePanel, type ScheduleRow, type SermonTrack } from './SchedulePanel';
import { SermonCenter } from './SermonCenter';
import { VersionPicker } from './VersionPicker';
import { ChapterRail } from './ChapterRail';

export interface SermonModeProps {
  themeMode: ThemeMode;
  keyHandlerRef: ModeKeyHandlerRef;
  active: boolean;
  onOpenSettings: () => void;
  // Bumped by App after a successful bible uninstall in SettingsModal — uninstall has no
  // IPC progress broadcast to piggyback on the way install's downloading/installing/done
  // phases do, so App mediates the refresh instead of SermonMode/SettingsModal reaching
  // into each other directly.
  biblesRevision: number;
}

const INSTALL_HINT = '[ Install a Bible in Settings ]';
const SCHEDULE_PANEL_W = 270;
const RIGHT_PANEL_W = 330;

export function SermonMode({ themeMode, keyHandlerRef, active, onOpenSettings, biblesRevision }: SermonModeProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const dark = themeMode === 'dark';
  const { output, liveKey } = usePresentationState();

  const [track, setTrack] = useState<SermonTrack>('scripture');
  const [scrBook, setScrBook] = useState('Genesis');
  const [scrCh, setScrCh] = useState(1);
  const [scrV, setScrV] = useState(1);
  const [versions, setVersions] = useState<string[]>(['kjv']);
  const [entryQ, setEntryQ] = useState('');
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [schedule, setSchedule] = useState<ScriptureReading[]>([]);
  const [manifest, setManifest] = useState<BibleManifestEntry[]>([]);

  // Guards the persist-on-change effect below from firing with the ['kjv'] default
  // before settings.get resolves (which would clobber a real saved selection).
  const versionsLoadedRef = useRef(false);

  // Applies a freshly-fetched manifest and, in the same beat, drops any compare-selected
  // version id that's no longer installed (e.g. removed in Settings, possibly while it's
  // part of the current selection) — falling back to the bundled KJV alone if that
  // empties the selection. Bundling both updates into one callback (rather than a
  // separate effect reacting to `manifest`) keeps the versions update tied to the event
  // that caused it instead of a passive state-watching effect. The cue effect further
  // down depends on `versions`, so this also re-cues the live slide to whatever's left.
  const applyManifest = useCallback((m: BibleManifestEntry[]): void => {
    setManifest(m);
    setVersions((v) => {
      const installedIds = new Set(m.filter((e) => e.installed).map((e) => e.id));
      const kept = v.filter((id) => installedIds.has(id));
      return kept.length ? kept : ['kjv'];
    });
  }, []);

  // Initial load: persisted version selection, the reading schedule, and the bible
  // manifest (for id -> abbr lookups). `live` guards each against a mode switch away
  // before the promise resolves.
  useEffect(() => {
    let live = true;
    void window.helm.settings
      .get<string[]>('scriptureVersions', ['kjv'])
      .then((v) => {
        if (!live) return;
        versionsLoadedRef.current = true;
        setVersions(v);
      })
      .catch(console.error);
    void window.helm.schedule
      .list()
      .then((r) => {
        if (live) setSchedule(r);
      })
      .catch(console.error);
    void window.helm.bibles
      .manifest()
      .then((m) => {
        if (live) applyManifest(m);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [applyManifest]);

  // Refresh the manifest on install completion/failure so a translation installed from
  // Settings mid-service becomes pickable in VersionPicker without an app restart.
  // Subscribed unconditionally (not gated on `active`) since SermonMode stays mounted
  // for the app's whole lifetime under the keep-alive contract.
  useEffect(() => {
    const offProgress = window.helm.bibles.onProgress((p) => {
      if (p.phase !== 'done' && p.phase !== 'error') return;
      void window.helm.bibles.manifest().then(applyManifest).catch(console.error);
    });
    return () => {
      offProgress();
    };
  }, [applyManifest]);

  // Uninstall (unlike install) has no IPC progress broadcast to piggyback on, so App
  // bumps `biblesRevision` after a successful SettingsModal uninstall and this effect
  // reacts by refetching. Revision starts at 0 and this only needs to fire on an actual
  // change, so the initial 0 is skipped to avoid duplicating the initial-load fetch above.
  useEffect(() => {
    if (biblesRevision === 0) return;
    let live = true;
    void window.helm.bibles
      .manifest()
      .then((m) => {
        if (live) applyManifest(m);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [biblesRevision, applyManifest]);

  // Persist the version selection once it changes after the initial load.
  useEffect(() => {
    if (!versionsLoadedRef.current) return;
    window.helm.settings.set('scriptureVersions', versions);
  }, [versions]);

  // Chapter cache: refetch on book/chapter change, and whenever the installed-version
  // set changes (a version installed mid-service wasn't in the last fetch).
  useEffect(() => {
    let live = true;
    void window.helm.bibles
      .getChapter(scrBook, scrCh)
      .then((c) => {
        if (live) setChapter(c);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [scrBook, scrCh, versions]);

  const abbrOf = useCallback(
    (id: string): string => {
      const m = manifest.find((e) => e.id === id);
      return m ? m.abbr : id.toUpperCase();
    },
    [manifest]
  );

  // `chapter` is fetched async and keyed by [scrBook, scrCh]; right after a cross-book/
  // chapter jump (schedule-row click, add-reading, Next verse past a boundary) there's a
  // render or two where `chapter` still holds the *previous* book's data before the new
  // fetch resolves. Reading it unguarded would show the old book's verse text mislabeled
  // under the new ref. Only trust it once it actually matches where we're looking.
  const liveChapter = chapter && chapter.book === scrBook && chapter.chapter === scrCh ? chapter : null;

  // Cue on every book/chapter/verse/version/chapter-data change (mirrors SongsMode).
  useEffect(() => {
    const key = keyForScripture(scrBook, scrCh, scrV);
    const cols = verseCols(liveChapter?.verses[scrV] ?? {}, versions, abbrOf);
    const slide = buildScriptureSlide(
      formatRef({ book: scrBook, ch: scrCh, from: scrV, to: scrV }),
      cols.length ? cols : [{ version: '', text: INSTALL_HINT }]
    );
    window.helm.presentation.cue(key, slide);
  }, [scrBook, scrCh, scrV, versions, liveChapter, abbrOf]);

  const curKey = keyForScripture(scrBook, scrCh, scrV);
  const cuedIsLive = output === 'live' && liveKey === curKey;
  const verseCount = liveChapter?.verseCount || 1;
  const liveCols = verseCols(liveChapter?.verses[scrV] ?? {}, versions, abbrOf);

  const stepVerse = (dir: 1 | -1): void => {
    setScrV((v) => Math.max(1, Math.min(verseCount, v + dir)));
  };

  const goLive = (): void => {
    // Right after a cross-book/chapter jump, `chapter` still holds the previous
    // chapter's data for a render or two (see the `liveChapter` comment above) — so
    // `liveCols` reads as [] and would build the install-hint slide even though a
    // bible IS installed and the real verse text is just one tick away. Bail out here
    // rather than going live with that false hint; the cue effect re-cues once
    // getChapter resolves and the operator can press again. The no-bible-installed
    // case is unaffected: getChapter still resolves to a (verse-less) ChapterData,
    // so liveChapter is non-null, this guard passes, liveCols is legitimately empty,
    // and the install-hint slide goes live, which is then the correct thing to show.
    if (!liveChapter) return;
    const slide = buildScriptureSlide(
      formatRef({ book: scrBook, ch: scrCh, from: scrV, to: scrV }),
      liveCols.length ? liveCols : [{ version: '', text: INSTALL_HINT }]
    );
    window.helm.presentation.goLive(curKey, slide);
  };

  const toggleLogo = (): void => {
    window.helm.presentation.setOutput(output === 'logo' ? 'live' : 'logo');
  };

  const jumpTo = (book: string, ch: number, v: number): void => {
    setScrBook(book);
    setScrCh(ch);
    setScrV(v);
  };

  // Builds the live slide for a single verse (the reading's `from`, matching where the
  // cue effect lands scrV) — not the whole reading range, so the on-screen ref/label
  // ("Genesis 1:1") matches what the hero and the cue effect would independently produce.
  const goLiveWithChapter = (p: ParsedRef, c: ChapterData): void => {
    const key = keyForScripture(p.book, p.ch, p.from);
    const cols = verseCols(c.verses[p.from] ?? {}, versions, abbrOf);
    const slide = buildScriptureSlide(
      formatRef({ book: p.book, ch: p.ch, from: p.from, to: p.from }),
      cols.length ? cols : [{ version: '', text: INSTALL_HINT }]
    );
    window.helm.presentation.goLive(key, slide);
  };

  // Mid-service headline flow: type a ref, Enter — it's on screen. Jumps the reading
  // state, schedules it, and goes live immediately (reusing the cached chapter when it
  // already matches, else fetching fresh so the live slide never shows stale text).
  const addReading = (): void => {
    const p = parseRef(entryQ);
    if (!p) return;
    window.helm.schedule.add(p).then(setSchedule).catch(console.error);
    setEntryQ('');
    setTrack('scripture');
    jumpTo(p.book, p.ch, p.from);
    if (chapter && chapter.book === p.book && chapter.chapter === p.ch) {
      goLiveWithChapter(p, chapter);
    } else {
      window.helm.bibles
        .getChapter(p.book, p.ch)
        .then((c) => {
          setChapter(c);
          goLiveWithChapter(p, c);
        })
        .catch(console.error);
    }
  };

  const onEntryKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addReading();
    } else if (e.key === ' ') {
      if (!/\d/.test(entryQ)) {
        const b = matchBook(entryQ.trim());
        if (b && norm(b) !== norm(entryQ.trim())) {
          e.preventDefault();
          setEntryQ(b + ' ');
        }
      }
    } else if (e.key === 'Escape') {
      // Clear the input first (mirrors SongsMode's search box); a second Escape once
      // it's already empty is a no-op here and falls through to the document-level
      // handler's modal-close semantics (Settings, if open) via normal bubbling.
      if (entryQ) setEntryQ('');
    }
  };

  const parsed = parseRef(entryQ);
  const hasParse = !!parsed;
  const addLabel = parsed ? `+ Add ${formatRef(parsed)}` : '';

  const scheduleRows: ScheduleRow[] = schedule.map((r) => {
    const isCurrent = r.book === scrBook && r.ch === scrCh && scrV >= r.from && scrV <= r.to;
    const n = r.to - r.from + 1;
    const primary = versions[0] ? abbrOf(versions[0]) : '';
    return {
      id: r.id,
      title: formatRef(r),
      meta: `${n} ${n === 1 ? 'verse' : 'verses'} · ${primary}`,
      isCurrent,
      onClick: () => jumpTo(r.book, r.ch, r.from)
    };
  });

  // On-deck: preview the next verse, tagged VERSE if it falls inside a scheduled
  // reading for this chapter, else KEEP READING; End-of-chapter past the last verse.
  const plannedSet = new Set<number>();
  for (const r of schedule) {
    if (r.book === scrBook && r.ch === scrCh) {
      for (let v = r.from; v <= r.to; v++) plannedSet.add(v);
    }
  }
  // Primary-version verse text, keyed by verse number — shared by the on-deck preview
  // and ChapterRail's per-verse cards.
  const previewOf = useCallback((v: number): string => liveChapter?.verses[v]?.[versions[0]] ?? '', [liveChapter, versions]);
  const isVerseLive = useCallback(
    (v: number): boolean => output === 'live' && liveKey === keyForScripture(scrBook, scrCh, v),
    [output, liveKey, scrBook, scrCh]
  );

  let ondeckTag = '—';
  let ondeckTagColor = T.faint;
  let ondeckTitle = '';
  let ondeckPreview = '';
  if (scrV < verseCount) {
    const nv = scrV + 1;
    ondeckTag = plannedSet.has(nv) ? 'VERSE' : 'KEEP READING';
    ondeckTagColor = T.scripture;
    ondeckTitle = `${scrBook} ${scrCh}:${nv}`;
    ondeckPreview = previewOf(nv);
  } else {
    ondeckTitle = `End of ${scrBook} ${scrCh}`;
    ondeckPreview = 'Pick the next reading on the left';
  }

  // Registers this mode's keyboard delegate only while active — App keeps both Songs
  // and Sermon mounted (keep-alive contract) so operator state survives tab switches.
  // While inactive, skip touching the ref entirely (don't null it here): a mode switch
  // re-runs both modes' effects in the same commit, and if this ran unconditionally it
  // could execute *after* the newly-active mode's effect in tree order and clobber the
  // handler it just set. Deactivation is handled by this effect's own cleanup instead,
  // which only fires when this mode was the one that last owned the ref.
  useEffect(() => {
    if (!active) return;
    keyHandlerRef.current = {
      onEscape: () => false,
      onArrow: (dir) => {
        if (track === 'scripture') stepVerse(dir);
      },
      onGoLive: () => {
        if (track === 'scripture') goLive();
      },
      // SermonMode has no App-level modal of its own (unlike SongsMode's QuickAdd) —
      // Settings, its only modal, is tracked directly in App via settingsOpen.
      isModalOpen: () => false
    };
    return () => {
      keyHandlerRef.current = null;
    };
  });

  const versionPicker = (
    <VersionPicker
      theme={T}
      manifest={manifest}
      versions={versions}
      onPick={(id) => setVersions((v) => pickVersion(v, id))}
      onOpenSettings={onOpenSettings}
    />
  );

  const rootStyle: CSSProperties = { flex: 1, minHeight: 0, display: 'flex', gap: '1px', background: T.hairline };
  const comingStyle: CSSProperties = {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    color: T.faint,
    fontSize: '13px',
    background: T.appBg
  };

  return (
    <div style={rootStyle}>
      <SchedulePanel
        theme={T}
        width={SCHEDULE_PANEL_W}
        track={track}
        setTrack={setTrack}
        entryQ={entryQ}
        setEntryQ={setEntryQ}
        onEntryKeyDown={onEntryKeyDown}
        hasParse={hasParse}
        addLabel={addLabel}
        onAdd={addReading}
        rows={scheduleRows}
      />
      {track === 'scripture' ? (
        <>
          <SermonCenter
            theme={T}
            output={output}
            cuedIsLive={cuedIsLive}
            heroLabel={formatRef({ book: scrBook, ch: scrCh, from: scrV, to: scrV })}
            cols={liveCols}
            ondeckTag={ondeckTag}
            ondeckTagColor={ondeckTagColor}
            ondeckTitle={ondeckTitle}
            ondeckPreview={ondeckPreview}
            versionPicker={versionPicker}
            onPrev={() => stepVerse(-1)}
            onNext={() => stepVerse(1)}
            onGoLive={goLive}
            onToggleLogo={toggleLogo}
          />
          <ChapterRail
            theme={T}
            dark={dark}
            width={RIGHT_PANEL_W}
            book={scrBook}
            ch={scrCh}
            verseCount={verseCount}
            plannedSet={plannedSet}
            cuedV={scrV}
            isVerseLive={isVerseLive}
            previewOf={previewOf}
            onSelect={setScrV}
          />
        </>
      ) : (
        <div style={comingStyle}>Coming in slice 4/5 — see the spec</div>
      )}
    </div>
  );
}
