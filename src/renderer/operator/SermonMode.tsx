import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import type { ModeKeyHandlerRef, ThemeMode } from './App';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState } from './useHelm';
import { formatRef, parseRef, type ParsedRef } from '../../shared/scripture/refs';
import {
  initialBuilder,
  applyKey,
  renderBuilder,
  toParsedRef,
  fromParsedRef,
  setStart,
  setEnd,
  EMPTY_EXTENT,
  type RefBuilderState
} from '../../shared/scripture/refBuilder';
import { buildScriptureSlide, keyForScripture, pickVersion, verseCols } from '../../shared/scripture/slides';
import { INSTALL_HINT } from '../../shared/scripture/labels';
import type { BibleManifestEntry, BookExtent, ChapterData, ScriptureReading } from '../../shared/types';
import { SchedulePanel, type ScheduleRow, type SermonTrack } from './SchedulePanel';
import { SermonCenter } from './SermonCenter';
import { VersionPicker } from './VersionPicker';
import { ChapterRail } from './ChapterRail';
import { MessageMode, type MessageKeyRef } from './MessageMode';
import { SlidesTrack, type SlidesKeyRef } from './SlidesTrack';
import { useContextMenu } from './useContextMenu';
import { useListSelection } from './useListSelection';
import { useTimedUndo } from './useTimedUndo';

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

const SCHEDULE_PANEL_W = 270;
const RIGHT_PANEL_W = 330;
// Stable no-op fallbacks for ChapterRail's planned/cued/live tint props when the rail is
// previewing a book/chapter OTHER than the cued one (see `railIsCued` below) — module-level
// so passing them doesn't allocate a fresh Set/closure every render.
const EMPTY_PLANNED = new Set<number>();
const NEVER_LIVE = (): boolean => false;

export function SermonMode({ themeMode, keyHandlerRef, active, onOpenSettings, biblesRevision }: SermonModeProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const dark = themeMode === 'dark';
  const { output, liveKey } = usePresentationState();

  const [track, setTrack] = useState<SermonTrack>('scripture');
  const [scrBook, setScrBook] = useState('Genesis');
  const [scrCh, setScrCh] = useState(1);
  const [scrV, setScrV] = useState(1);
  const [versions, setVersions] = useState<string[]>(['kjv']);
  const [builder, setBuilder] = useState<RefBuilderState>(initialBuilder());
  // Per-book chapter/verse-count cache for the builder's digit clamping. Kept as state
  // (not a ref) so reading it during render — for `curExtent` below — doesn't trip
  // react-hooks' no-ref-reads-during-render check; the effect below only writes an entry
  // once per book, so this never grows unbounded or re-fetches.
  const [bookExtents, setBookExtents] = useState<Record<string, BookExtent>>({});
  const [chapter, setChapter] = useState<ChapterData | null>(null);
  const [schedule, setSchedule] = useState<ScriptureReading[]>([]);
  const [manifest, setManifest] = useState<BibleManifestEntry[]>([]);

  const contextMenu = useContextMenu();
  const sel = useListSelection();
  const undo = useTimedUndo<ScriptureReading>();

  // Private ref MessageMode populates with its own arrow/goLive handlers while it's
  // mounted and active — kept separate from `keyHandlerRef` below so SermonMode remains
  // that ref's sole owner (see the keyHandlerRef-registration effect's comment and
  // MessageMode's MessageKeyHandler doc comment for why: two effects racing to write the
  // same ref is order-dependent on which mode committed last).
  const messageKeyRef: MessageKeyRef = useRef(null);

  // Private ref SlidesTrack populates with its own arrow/goLive handlers while it's
  // mounted and active — same pattern as messageKeyRef above, for the same reason.
  const slidesKeyRef: SlidesKeyRef = useRef(null);

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

  // Fetch (once, cached) the BookExtent for the builder's resolved book, falling back to
  // the previewed (cued) book when the builder hasn't resolved one yet (`builder.book ??
  // scrBook`, same fallback `previewBook` uses below) — otherwise a fresh session never
  // fetches the cued book's extent, and the first click on a cued-chapter verse rail card
  // seeds `book: previewBook` with no extent cached, clamping to EMPTY_EXTENT and dropping
  // the click. Version-agnostic — main resolves the installed version.
  useEffect(() => {
    const b = builder.book ?? scrBook;
    if (!b || bookExtents[b]) return;
    let live = true;
    void window.helm.bibles
      .bookExtent(b)
      .then((ext) => {
        if (!live) return;
        setBookExtents((prev) => ({ ...prev, [b]: ext }));
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [builder.book, scrBook, bookExtents]);

  const curExtent = builder.book ? bookExtents[builder.book] ?? EMPTY_EXTENT : EMPTY_EXTENT;

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

  // Immediate remove + a self-clearing "Removed — Undo" affordance (no blocking dialog).
  // Toast/selection-clear happen on IPC success so a rejected remove doesn't falsely claim
  // removal. Undo re-adds via schedule.add, which appends at the end (position-preserving
  // restore is a follow-up — see the interaction-primitives design's Known caveats).
  const removeReading = (id: string): void => {
    const reading = schedule.find((r) => r.id === id);
    if (!reading) return;
    window.helm.schedule
      .remove(id)
      .then((rows) => {
        setSchedule(rows);
        if (sel.isSelected(id)) sel.clear();
        undo.arm(reading);
      })
      .catch(console.error);
  };

  const undoRemove = (): void => {
    if (!undo.pending) return;
    const { book, ch, from, to } = undo.pending;
    window.helm.schedule.add({ book, ch, from, to }).then(setSchedule).catch(console.error);
    undo.cancel();
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

  // The rail previews the builder's book+chapter when resolved, else the cued chapter.
  const previewBook = builder.book ?? scrBook;
  const previewCh = builder.chapter ?? scrCh;
  const selectedRange =
    builder.startVerse !== null
      ? {
          from: Math.min(builder.startVerse, builder.endVerse ?? builder.startVerse),
          to: Math.max(builder.startVerse, builder.endVerse ?? builder.startVerse)
        }
      : null;

  // Preview chapter data, kept separate from `chapter` (the live/cued chapter cache
  // above) so previewing a different book/chapter while building a ref doesn't disturb
  // the live-cued chapter fetch.
  const [previewChapter, setPreviewChapter] = useState<ChapterData | null>(null);

  useEffect(() => {
    let live = true;
    void window.helm.bibles
      .getChapter(previewBook, previewCh)
      .then((c) => {
        if (live) setPreviewChapter(c);
      })
      .catch(console.error);
    return () => {
      live = false;
    };
  }, [previewBook, previewCh, versions]);

  const railChapter =
    previewChapter && previewChapter.book === previewBook && previewChapter.chapter === previewCh
      ? previewChapter
      : null;
  const railVerseCount = railChapter?.verseCount || 1;
  const railPreviewOf = useCallback(
    (v: number): string => railChapter?.verses[v]?.[versions[0]] ?? '',
    [railChapter, versions]
  );

  // `plannedSet`/`cuedV`/`isVerseLive` below are all computed against the CUED book/chapter
  // (scrBook/scrCh), but the rail previews `previewBook`/`previewCh` — which diverge while
  // the operator is building a reading in a different book/chapter than the one currently
  // cued. Gate them off (empty set / no-match verse / always-false) so a chapter the
  // operator is merely previewing doesn't pick up the cued chapter's planned highlights,
  // a spurious CUED badge, or a misleading LIVE badge.
  const railIsCued = previewBook === scrBook && previewCh === scrCh;

  // Mid-service headline flow: build a ref, Enter — it's on screen. Schedules it, resets
  // the builder, and (Enter, not Shift+Enter) jumps + goes live immediately (reusing the
  // cached chapter when it already matches, else fetching fresh so the live slide never
  // shows stale text).
  const commitBuilder = (goLiveToo: boolean): void => {
    const p = toParsedRef(builder);
    if (!p) return;
    window.helm.schedule.add(p).then(setSchedule).catch(console.error);
    setBuilder(initialBuilder());
    setTrack('scripture');
    if (goLiveToo) {
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
    }
  };

  const onEntryKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitBuilder(e.shiftKey);
      return;
    }
    if (e.key === 'Escape') {
      // Clear the builder first; a second Escape (already empty) falls through to the
      // document-level modal-close handler (Settings) via normal bubbling — matches today.
      if (renderBuilder(builder) !== '') {
        e.preventDefault();
        setBuilder(initialBuilder());
      }
      return;
    }
    const r = applyKey(builder, e.key, e.shiftKey, curExtent);
    if (r.preventDefault) e.preventDefault();
    if (r.state !== builder) setBuilder(r.state);
  };

  // Paste / IME: if the whole field parses as a ref, load it structurally.
  const onEntryChange = (v: string): void => {
    const p = parseRef(v);
    if (p) setBuilder(fromParsedRef(p));
  };

  const parsed = toParsedRef(builder);
  const canAdd = parsed !== null;
  const addLabel = parsed ? `+ Add ${formatRef(parsed)}` : '';

  // Click-select in the rail writes the same RefBuilderState as typing. If the builder has
  // no resolved book yet, seed it from the previewed (cued) chapter so a click there starts
  // a fresh selection in that chapter.
  const onRailSelectVerse = (v: number, shift: boolean): void => {
    setBuilder((b) => {
      const seeded: RefBuilderState =
        b.book === null || b.chapter === null
          ? { ...initialBuilder(), stage: 'verse', book: previewBook, chapter: previewCh, startVerse: null, endVerse: null }
          : b;
      const ext = bookExtents[seeded.book ?? ''] ?? EMPTY_EXTENT;
      if (shift) return setEnd(seeded, v, ext);
      // No open selection (fresh or just-completed range) -> start; a start set with no end
      // and a *different* verse -> end; same verse -> stay single.
      if (seeded.startVerse === null || seeded.endVerse !== null) return setStart(seeded, v, ext);
      if (v === seeded.startVerse) return seeded;
      return setEnd(seeded, v, ext);
    });
  };

  const scheduleRows: ScheduleRow[] = schedule.map((r) => {
    const isCurrent = r.book === scrBook && r.ch === scrCh && scrV >= r.from && scrV <= r.to;
    const n = r.to - r.from + 1;
    const primary = versions[0] ? abbrOf(versions[0]) : '';
    return {
      id: r.id,
      title: formatRef(r),
      meta: `${n} ${n === 1 ? 'verse' : 'verses'} · ${primary}`,
      isCurrent,
      isSelected: sel.isSelected(r.id),
      onClick: () => {
        jumpTo(r.book, r.ch, r.from);
        sel.select(r.id);
      },
      onContextMenu: (e) => {
        sel.select(r.id);
        contextMenu.open(e, [{ label: 'Delete', danger: true, onSelect: () => removeReading(r.id) }]);
      }
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
        else if (track === 'message') messageKeyRef.current?.onArrow(dir);
        else if (track === 'slides') slidesKeyRef.current?.onArrow(dir);
      },
      onGoLive: () => {
        if (track === 'scripture') goLive();
        else if (track === 'message') messageKeyRef.current?.onGoLive();
        else if (track === 'slides') slidesKeyRef.current?.onGoLive();
      },
      // SermonMode has no App-level modal of its own (unlike SongsMode's QuickAdd) —
      // Settings, its only modal, is tracked directly in App via settingsOpen.
      isModalOpen: () => false,
      onDelete: () => {
        if (track === 'scripture' && sel.selectedId) removeReading(sel.selectedId);
      }
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

  return (
    <div style={rootStyle}>
      {track === 'message' ? (
        // Message track: MessageMode renders its own single left rail (TrackTabs +
        // MessageSearchRail) plus the center hero and ParagraphRail — SchedulePanel is
        // NOT also rendered here, since that would double up the rail (SchedulePanel's
        // tabs-only panel as one column, MessageSearchRail as a second sibling column).
        <MessageMode themeMode={themeMode} messageKeyRef={messageKeyRef} active={active} track={track} setTrack={setTrack} />
      ) : track === 'slides' ? (
        // Slides track: same reasoning as Message above — SlidesTrack owns its own
        // TrackTabs + media-library rail + hero + deck rail, so SchedulePanel (whose
        // body only ever renders for 'scripture') is not also rendered as a sibling.
        <SlidesTrack slidesKeyRef={slidesKeyRef} active={active} track={track} setTrack={setTrack} />
      ) : (
        <>
          <SchedulePanel
            theme={T}
            width={SCHEDULE_PANEL_W}
            track={track}
            setTrack={setTrack}
            value={renderBuilder(builder)}
            onEntryChange={onEntryChange}
            onEntryKeyDown={onEntryKeyDown}
            canAdd={canAdd}
            addLabel={addLabel}
            onAdd={() => commitBuilder(false)}
            rows={scheduleRows}
            undo={undo.pending ? { label: formatRef(undo.pending), onUndo: undoRemove } : undefined}
          />
          <SermonCenter
            theme={T}
            variant="verse"
            accent={T.scripture}
            output={output}
            cuedIsLive={cuedIsLive}
            heroLabel={formatRef({ book: scrBook, ch: scrCh, from: scrV, to: scrV })}
            cols={liveCols}
            ondeckTag={ondeckTag}
            ondeckTagColor={ondeckTagColor}
            ondeckTitle={ondeckTitle}
            ondeckPreview={ondeckPreview}
            nextLabel={'Next verse ›'}
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
            book={previewBook}
            ch={previewCh}
            verseCount={railVerseCount}
            plannedSet={railIsCued ? plannedSet : EMPTY_PLANNED}
            cuedV={railIsCued ? scrV : -1}
            isVerseLive={railIsCued ? isVerseLive : NEVER_LIVE}
            previewOf={railPreviewOf}
            selectedRange={selectedRange}
            onSelectVerse={onRailSelectVerse}
          />
        </>
      )}
      {contextMenu.menu}
    </div>
  );
}
