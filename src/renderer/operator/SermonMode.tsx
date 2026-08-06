import { useCallback, useContext, useEffect, useRef, useState, type CSSProperties, type JSX, type KeyboardEvent } from 'react';
import type { ModeKeyHandlerRef, ThemeMode } from './App';
import type { ResolvedHotkey } from '../../shared/hotkeys/match';
import { ThemeCtx } from './ThemeCtx';
import { usePresentationState } from './useHelm';
import { formatRef, parseRef, type ParsedRef } from '../../shared/scripture/refs';
import {
  initialBuilder,
  applyKey,
  renderBuilder,
  fromParsedRef,
  toParsedRef,
  refGhost,
  EMPTY_EXTENT,
  type RefBuilderState
} from '../../shared/scripture/refBuilder';
import { railSelect, addTarget, type Cursor } from '../../shared/scripture/selection';
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
import { usePanelWidth } from './usePanelWidth';
import { PanelDivider } from './PanelDivider';

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
  // Bumped by App's scripture-lookup hotkey; the effects below force the scripture
  // track and focus the entry.
  lookupNonce: number;
}

const SERMON_LEFT = { def: 270, min: 200, max: 420, anchor: 'left' } as const;
const SERMON_RIGHT = { def: 330, min: 240, max: 520, anchor: 'right' } as const;
// Stable no-op fallbacks for ChapterRail's planned/cued/live tint props when the rail is
// previewing a book/chapter OTHER than the cued one (see `railIsCued` below) — module-level
// so passing them doesn't allocate a fresh Set/closure every render.
const EMPTY_PLANNED = new Set<number>();
const NEVER_LIVE = (): boolean => false;

export function SermonMode({
  themeMode,
  keyHandlerRef,
  active,
  onOpenSettings,
  biblesRevision,
  lookupNonce
}: SermonModeProps): JSX.Element {
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

  // Shared by all tracks (Task 4 threads these into MessageMode/SlidesTrack too), so
  // they live at the top level rather than inside the scripture-track branch below.
  const leftPanel = usePanelWidth('helmSermonLeftW', SERMON_LEFT);
  const rightPanel = usePanelWidth('helmSermonRightW', SERMON_RIGHT);

  // Private ref MessageMode populates with its own arrow/goLive handlers while it's
  // mounted and active — kept separate from `keyHandlerRef` below so SermonMode remains
  // that ref's sole owner (see the keyHandlerRef-registration effect's comment and
  // MessageMode's MessageKeyHandler doc comment for why: two effects racing to write the
  // same ref is order-dependent on which mode committed last).
  const messageKeyRef: MessageKeyRef = useRef(null);

  // Private ref SlidesTrack populates with its own arrow/goLive handlers while it's
  // mounted and active — same pattern as messageKeyRef above, for the same reason.
  const slidesKeyRef: SlidesKeyRef = useRef(null);

  const entryRef = useRef<HTMLInputElement | null>(null);
  // Which lookupNonce the focus effect below has already handled, so a track change made
  // for any OTHER reason while idle (e.g. clicking Message) doesn't re-steal focus back to
  // an entry the operator never asked to jump to.
  const focusedLookupRef = useRef(0);

  // Scripture-lookup hotkey, part 1: force the scripture track. Deferred into a timeout
  // rather than called inline in the effect body — a same-tick setState here is exactly
  // the render-cascade shape react-hooks/set-state-in-effect flags, and there's already a
  // real reason to defer: the focus effect below needs SchedulePanel's input to have
  // mounted (it isn't rendered on the message/slides tracks) before it can reach it.
  useEffect(() => {
    if (lookupNonce === 0) return;
    const t = setTimeout(() => setTrack('scripture'), 0);
    return () => clearTimeout(t);
  }, [lookupNonce]);

  // Scripture-lookup hotkey, part 2: once `track` actually reads 'scripture' — either
  // already did (this effect then fires on the same tick as the nonce bump) or only after
  // part 1's timeout lands the switch — focus the entry. The focusedLookupRef guard makes
  // this idempotent per press: it only acts once per lookupNonce value, however many times
  // `track` changes afterward.
  useEffect(() => {
    if (lookupNonce === 0 || lookupNonce === focusedLookupRef.current) return;
    if (track !== 'scripture') return;
    focusedLookupRef.current = lookupNonce;
    entryRef.current?.focus();
  }, [lookupNonce, track]);

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
  // scrBook`, same fallback `previewBook` uses below).
  //
  // The extent is what `applyKey` clamps typed digits against (clampChapter/clampVerse in
  // refBuilder.ts), and an absent one is EMPTY_EXTENT — which clamps every digit to 0, i.e.
  // back to null, so keystrokes are silently swallowed. Fetching on `builder.book` alone
  // would always lose that race: the book resolves the instant the operator hits space, and
  // the chapter digits follow in the same breath, well before an IPC round trip lands. The
  // `?? scrBook` fallback prefetches the cued book's extent up front, so continuing in the
  // book already on screen — the common case — types cleanly from the first digit.
  // Version-agnostic — main resolves the installed version.
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

  // The cursor's route to the screen: `show` on every book/chapter/verse/version/
  // chapter-data change. Unlike the `cue` this replaced, it follows across chapters and
  // books — moving the cursor while live moves the projector, wherever you move it.
  //
  // Bail while `liveChapter` is null. It is null for a render or two after a cross-book/
  // chapter jump (see its comment above), and `show` — having no sameFlow guard to make
  // that an accidental no-op the way `cue` did — would otherwise push the INSTALL_HINT
  // slide onto the projector mid-service. `liveChapter` is a dep, so this re-runs with the
  // real text the moment the fetch resolves; the screen holds the previous verse for that
  // tick rather than flashing a false "no bible installed". Same guard, same reason, as
  // `goLive` below.
  //
  // `output` is a REAL dependency even though the effect body never reads it — do not prune
  // it. Main's `showLive` no-ops unless output is live, so every cursor move made while the
  // logo is up is dropped; flipping back to live restores the OLD liveSnap, leaving the
  // projector on a verse the hero stopped showing. Re-firing on `output` re-sends the
  // cursor at that moment, and the effect is idempotent, so the extra runs cost nothing.
  //
  // `active && track === 'scripture'` gates this to SermonMode actually being the surface
  // the operator is driving. SermonMode stays mounted for the app's whole life (keep-alive,
  // App.tsx renders it `display:none` when inactive), and it owns `track` on top of that —
  // so without this gate, a cursor that is merely sitting in a background mode/track can
  // still reach the projector. That's not hypothetical: main's `showLive` allows an update
  // when nothing is live yet (`liveKey === null`, so a fresh rail can fill an empty screen),
  // and `output` is a dep above — so an unrelated output flip (e.g. Logo on/off in Songs
  // mode, on a fresh session) re-fires this effect and, with no gate, would push this
  // inactive mode's scripture cursor onto the projector.
  useEffect(() => {
    if (!active || track !== 'scripture') return;
    if (!liveChapter) return;
    const key = keyForScripture(scrBook, scrCh, scrV);
    const cols = verseCols(liveChapter.verses[scrV] ?? {}, versions, abbrOf);
    const slide = buildScriptureSlide(
      formatRef({ book: scrBook, ch: scrCh, from: scrV, to: scrV }),
      cols.length ? cols : [{ version: '', text: INSTALL_HINT }]
    );
    window.helm.presentation.show(key, slide);
  }, [scrBook, scrCh, scrV, versions, liveChapter, abbrOf, output, active, track]);

  const curKey = keyForScripture(scrBook, scrCh, scrV);
  const cuedIsLive = output === 'live' && liveKey === curKey;
  const verseCount = liveChapter?.verseCount || 1;
  const liveCols = verseCols(liveChapter?.verses[scrV] ?? {}, versions, abbrOf);

  // One-shot scroll commands for ChapterRail — see its scrollRequest prop doc. `railScroll`
  // itself is never cleared after use (nonces only ever go up, so re-passing the same
  // object is harmless while ChapterRail stays mounted — its own effect no-ops on an
  // unchanged nonce/verseCount pair). The problem is remounting: switching the Sermon
  // track away and back unmounts/remounts ChapterRail, and a mount effect always runs
  // once regardless of whether its deps "changed" from some previous instance — so
  // without `consumedNonce`, the last already-applied request would fire again on every
  // remount. `consumedNonce` tracks the highest nonce ChapterRail has confirmed (via
  // `onScrollConsumed`, below) actually landed a scroll; `scrollRequest` is withheld once
  // its nonce is no longer greater than that. State rather than a ref deliberately — a
  // ref can't be read while computing the JSX prop below (that's a render-phase ref read,
  // which this repo's lint config rejects), and the setState below lives in a plain
  // callback invoked by the child, not inside one of this component's own effects, so it
  // doesn't run into the set-state-in-effect rule either. A genuinely fresh nonce (e.g.
  // goLiveFromBuilder switching track and requesting a scroll in the same commit) always
  // clears the `>` check and fires on the fresh mount as it should.
  const [railScroll, setRailScroll] = useState<{ v: number; align: 'start' | 'nearest'; nonce: number } | null>(
    null
  );
  const [consumedNonce, setConsumedNonce] = useState(0);
  const requestRailScroll = (v: number, align: 'start' | 'nearest'): void =>
    setRailScroll((p) => ({ v, align, nonce: (p?.nonce ?? 0) + 1 }));

  const stepVerse = (dir: 1 | -1): void => {
    // Same stale-chapter guard as `goLive` and the show effect. While `liveChapter` is
    // null, `verseCount` falls back to 1, so `Math.min(verseCount, v + dir)` would
    // collapse the cursor to verse 1 — and the show effect would then put verse 1 on the
    // projector. Ignore the arrow for that tick; the operator can press again.
    if (!liveChapter) return;
    const nv = Math.max(1, Math.min(verseCount, scrV + dir));
    setScrV(nv);
    requestRailScroll(nv, 'nearest');
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
    // Do exactly what the button says, rather than re-deriving the decision inside the
    // main-process `goLive` verb (which blacks when fired on the key already live). The
    // cursor now commits to the screen as it moves, so by the time the operator reaches
    // for the button the verse is usually ALREADY live — under the old toggle, the
    // trained "tap the verse, then press Go live" two-step took the screen down. The
    // label reads "■ Take down" exactly when `cuedIsLive`, so branch on the same flag.
    if (cuedIsLive) {
      window.helm.presentation.setOutput('black');
      return;
    }
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

  // The reading 1–9 hotkey and a schedule-row click are the same gesture: cursor to the
  // reading's start, row selected, rail pinned to that verse. Resets the builder (like
  // goLiveFromBuilder already does) so a half-typed ref left over in the entry (e.g. "Rom")
  // doesn't keep previewing ITS book on the rail — without this, the fresh scroll request
  // above would pin the reading's verse number onto whatever book the builder was on.
  const jumpToReading = (r: ScriptureReading): void => {
    setBuilder(initialBuilder());
    jumpTo(r.book, r.ch, r.from);
    sel.select(r.id);
    requestRailScroll(r.from, 'start');
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

  // Paste / IME: if the whole field parses as a ref, load it structurally.
  const onEntryChange = (v: string): void => {
    const p = parseRef(v);
    if (p) setBuilder(fromParsedRef(p));
  };

  // The cursor, as the pure selection helpers want it.
  const cursor: Cursor = { book: scrBook, ch: scrCh, v: scrV };
  // What `+ Add` and Enter would file: the typed ref when the entry holds one, else the
  // cursor's verse. Always something, so the button is always offered — a mouse-only
  // operator never has to know the keyboard flow to schedule what they're looking at.
  const addRef = addTarget(builder, cursor);
  const addLabel = `+ Add ${formatRef(addRef)}`;

  // The operator has typed something that is not yet a reference — "Rom" (no book match
  // yet), or "Romans" (book matched, no chapter). `addTarget` falls back to the cursor in
  // both cases, so an UNLABELLED commit here would file — or worse, put on screen — a verse
  // nobody named. An EMPTY entry is deliberately NOT this case: it must still commit the
  // cursor, which is the keyboard twin of the Go live button. Written against renderBuilder
  // / toParsedRef rather than a stage check so it means exactly "the entry shows text that
  // doesn't parse", however the builder got there.
  //
  // Deliberately NOT applied inside `addToSchedule`, only to the blind Enter keystroke below
  // (and unconditionally to `goLiveFromBuilder`, which forces output live and must never
  // guess). The `+ Add` button is labelled `+ Add ${formatRef(addRef)}` — it names the exact
  // verse it will file — so a click is never a surprise even while the entry shows something
  // different, it only ever writes a schedule row, and a wrong row is right-click Delete
  // with an Undo affordance. Refusing the click instead would strand a mouse-only operator:
  // the entry has no clearable affordance, Delete is inert there, and the only rail tap that
  // clears the builder also moves the projector.
  const builderUnresolved = renderBuilder(builder) !== '' && toParsedRef(builder) === null;

  // The completion the entry previews. Same function the space/Tab handler commits with,
  // so what the operator sees and what the keystroke does cannot disagree.
  const ghost = refGhost(builder);

  // Two independent commits. The schedule is a plan; it is not a gate to the projector, and
  // nothing that reaches the projector writes a row. Enter and `+ Add` file; Shift+Enter and
  // the Go live button show. Both read `addRef`, so an empty entry commits the cursor's
  // verse — Shift+Enter on an empty field is the keyboard twin of the Go live button.
  const addToSchedule = (): void => {
    window.helm.schedule.add(addRef).then(setSchedule).catch(console.error);
    setBuilder(initialBuilder());
    setTrack('scripture');
  };

  const goLiveFromBuilder = (): void => {
    if (builderUnresolved) return;
    const p = addRef;
    setBuilder(initialBuilder());
    setTrack('scripture');
    // Move the cursor first, unconditionally: the already-live guard below returns early,
    // and if it did so before this the hero would keep showing a different reference than
    // the projector. Safe to do ahead of the guard — the show effect this triggers is a
    // same-key no-op when the guard is about to fire.
    jumpTo(p.book, p.ch, p.from);
    requestRailScroll(p.from, 'start');
    // `goLive` blacks the output when fired on the key already live (see
    // shared/presentation/core.ts) — correct for the Go live / Take down button, wrong here.
    // Shift+Enter names a reference, so blanking is never what was asked for; if it's
    // already up, we're done.
    const key = keyForScripture(p.book, p.ch, p.from);
    if (output === 'live' && liveKey === key) return;
    // Reuse the cached chapter when it already matches, else fetch fresh so the live slide
    // never shows stale text from the previous book.
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
      // Enter is blind — no label naming what it will file — so it refuses a half-typed
      // reference rather than silently substituting the cursor, and leaves the typing in
      // place to be finished. The `+ Add` button, which says what it files, does not.
      if (e.shiftKey) goLiveFromBuilder();
      else if (!builderUnresolved) addToSchedule();
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

  // A click on a verse card. Plain tap moves the cursor — which reaches the projector via
  // the show effect above when output is live, and is a quiet preview when it isn't.
  // Shift-tap leaves the cursor and writes a range into the builder instead, anchored at the
  // start verse already typed into the entry when it names this previewed book/chapter (the
  // one `selectedRange` highlights on the rail), else at the cursor. The decision itself
  // lives in `railSelect` so it can be tested without mounting this component.
  const onRailSelectVerse = (v: number, shift: boolean): void => {
    const next = railSelect(builder, cursor, { book: previewBook, ch: previewCh }, v, shift);
    setBuilder(next.builder);
    jumpTo(next.cursor.book, next.cursor.ch, next.cursor.v);
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
      onClick: () => jumpToReading(r),
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
      },
      onAction: (a: ResolvedHotkey) => {
        if (track !== 'scripture') return;
        if (a.id === 'scripture.reading' && a.digit) {
          const r = schedule[a.digit - 1];
          if (r) jumpToReading(r);
        } else if (a.id === 'focus.search') {
          entryRef.current?.focus();
        } else if (a.id === 'field.clear') {
          setBuilder(initialBuilder());
        }
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
        <MessageMode
          themeMode={themeMode}
          messageKeyRef={messageKeyRef}
          active={active}
          track={track}
          setTrack={setTrack}
          leftPanel={leftPanel}
          rightPanel={rightPanel}
        />
      ) : track === 'slides' ? (
        // Slides track: same reasoning as Message above — SlidesTrack owns its own
        // TrackTabs + media-library rail + hero + deck rail, so SchedulePanel (whose
        // body only ever renders for 'scripture') is not also rendered as a sibling.
        <SlidesTrack
          slidesKeyRef={slidesKeyRef}
          active={active}
          track={track}
          setTrack={setTrack}
          leftPanel={leftPanel}
          rightPanel={rightPanel}
        />
      ) : (
        <>
          <SchedulePanel
            theme={T}
            width={leftPanel.width}
            track={track}
            setTrack={setTrack}
            value={renderBuilder(builder)}
            onEntryChange={onEntryChange}
            onEntryKeyDown={onEntryKeyDown}
            ghost={ghost}
            // Unconditional on purpose: `+ Add` is always there for an operator who only
            // uses the GUI. Its label names the verse it will file, so it stays honest even
            // while the entry holds a half-typed reference (see `builderUnresolved`).
            canAdd
            addLabel={addLabel}
            onAdd={addToSchedule}
            rows={scheduleRows}
            undo={undo.pending ? { label: formatRef(undo.pending), onUndo: undoRemove } : undefined}
            entryRef={entryRef}
          />
          <PanelDivider active={leftPanel.dragging} onMouseDown={leftPanel.startDrag} />
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
          <PanelDivider active={rightPanel.dragging} onMouseDown={rightPanel.startDrag} />
          <ChapterRail
            theme={T}
            dark={dark}
            width={rightPanel.width}
            book={previewBook}
            ch={previewCh}
            verseCount={railVerseCount}
            plannedSet={railIsCued ? plannedSet : EMPTY_PLANNED}
            cuedV={railIsCued ? scrV : -1}
            isVerseLive={railIsCued ? isVerseLive : NEVER_LIVE}
            previewOf={railPreviewOf}
            selectedRange={selectedRange}
            onSelectVerse={onRailSelectVerse}
            scrollRequest={railScroll && railScroll.nonce > consumedNonce ? railScroll : null}
            onScrollConsumed={setConsumedNonce}
          />
        </>
      )}
      {contextMenu.menu}
    </div>
  );
}
