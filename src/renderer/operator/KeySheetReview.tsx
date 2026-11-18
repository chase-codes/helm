import { useContext, useState, type CSSProperties, type JSX } from 'react';
import type { MusicKeyRow } from '../../shared/types';
import { KEY_IMPORT_GROUPS, keyOf, type KeyImportGroup, type KeyImportRow } from '../../shared/songs/keySheet';
import { useWindowedList } from '../shared/useWindowedList';
import { useDebouncedSearch } from './useDebouncedSearch';
import { MONO } from '../shared/fonts';
import { ThemeCtx } from './ThemeCtx';
import { GROUP_WORDS, PROBLEM_WORDS } from './songKeysText';

// The review for `+ Import keys from a spreadsheet` (song keys spec, Phase 2): the look-first
// step before one batch (grammar rule 4), inside the Song keys window like the title sweep's.
// One tab per group, with its count; each tab is its own windowed list (a sheet can hold
// 3,000 rows) with one fixed row height, so nothing in a row may wrap (rule 5). Reasons are
// T.dim, never red (rule 1). Nothing is written from here: the window applies the batch.
//
// A row is checked when the map holds a song for its line. Ready starts checked; every other
// row needs a person: Already has a different key is a checkbox (checking switches the song
// to the sheet's key), Pick one and Not found need a song chosen, Not a key cannot be set.

const GAP = 3;
const LINE_H = 34;
const CHOICE_H = 26;
/** Row heights per group, gap included. Pick one and Not found keep room for three songs. */
const ROW_H: Record<KeyImportGroup, number> = {
  ready: LINE_H + GAP,
  different: LINE_H + GAP,
  'not-a-key': LINE_H + GAP,
  pick: LINE_H + 3 * CHOICE_H + 8 + GAP,
  'not-found': LINE_H + 3 * CHOICE_H + 8 + GAP
};

export interface KeySheetReviewProps {
  rows: KeyImportRow[];
  checked: ReadonlyMap<number, MusicKeyRow>;
  /** Check a row for this song, or uncheck it (null). */
  onCheck: (line: number, song: MusicKeyRow | null) => void;
}

const clip: CSSProperties = { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 };

/** The first group with rows, Ready first: where the review opens. */
const firstGroup = (rows: KeyImportRow[]): KeyImportGroup => KEY_IMPORT_GROUPS.find((g) => rows.some((r) => r.group === g)) ?? 'ready';

export function KeySheetReview({ rows, checked, onCheck }: KeySheetReviewProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const [group, setGroup] = useState<KeyImportGroup>(() => firstGroup(rows));
  // Not found's hand searches, by sheet line: kept here so a row scrolled out and back keeps its words.
  const [queries, setQueries] = useState<ReadonlyMap<number, string>>(new Map());
  const shown = rows.filter((r) => r.group === group);
  const count = (g: KeyImportGroup): number => rows.filter((r) => r.group === g).length;

  const tabWrapStyle: CSSProperties = { display: 'flex', gap: '3px', background: T.panel2, padding: '3px', borderRadius: '9px', flexShrink: 0 };
  const tabStyle = (on: boolean, empty: boolean): CSSProperties => ({
    flex: 1,
    minWidth: 0,
    height: '28px',
    borderRadius: '7px',
    fontSize: '11.5px',
    fontWeight: on ? 700 : 600,
    color: on ? T.accentInk : T.faint,
    background: on ? T.accent : 'transparent',
    opacity: empty && !on ? 0.55 : 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '6px',
    whiteSpace: 'nowrap'
  });

  return (
    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }} data-key-sheet-review>
      <div style={tabWrapStyle} role="tablist">
        {KEY_IMPORT_GROUPS.map((g) => {
          const n = count(g);
          return (
            <button key={g} role="tab" aria-selected={group === g} style={tabStyle(group === g, n === 0)} onClick={() => setGroup(g)} data-sheet-group={g}>
              <span style={clip}>{GROUP_WORDS[g]}</span>
              <span style={{ fontFamily: MONO, fontSize: '10.5px', opacity: 0.8 }}>{n.toLocaleString()}</span>
            </button>
          );
        })}
      </div>
      <GroupList
        key={group}
        group={group}
        rows={shown}
        checked={checked}
        onCheck={onCheck}
        queries={queries}
        onQuery={(line, q) =>
          setQueries((cur) => {
            const next = new Map(cur);
            next.set(line, q);
            return next;
          })
        }
      />
    </div>
  );
}

interface GroupListProps extends KeySheetReviewProps {
  group: KeyImportGroup;
  queries: ReadonlyMap<number, string>;
  onQuery: (line: number, q: string) => void;
}

/** One group's rows. Keyed by group, so a switch starts at the top with that group's height. */
function GroupList({ group, rows, checked, onCheck, queries, onQuery }: GroupListProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const rowH = ROW_H[group];
  const { setEl, onScroll, start, end, topPad, bottomPad } = useWindowedList(rows.length, rowH);
  if (!rows.length) {
    return <div style={{ padding: '18px 10px', fontSize: '13px', color: T.faint }}>{EMPTY_WORDS[group]}</div>;
  }
  return (
    <div ref={setEl} onScroll={onScroll} style={{ flex: 1, minHeight: 0, overflowY: 'auto', marginTop: '8px' }} data-sheet-list>
      <div style={{ height: `${topPad}px` }} />
      {rows.slice(start, end).map((r) => (
        <SheetRow key={r.line} r={r} height={rowH - GAP} chosen={checked.get(r.line) ?? null} onCheck={onCheck} query={queries.get(r.line) ?? ''} onQuery={onQuery} />
      ))}
      <div style={{ height: `${bottomPad}px` }} />
    </div>
  );
}

const EMPTY_WORDS: Record<KeyImportGroup, string> = {
  ready: 'No row matched one song with no key.',
  pick: 'No row needs a song picked.',
  different: 'No song in the sheet has a different key in Helm.',
  'not-a-key': 'Every key in the sheet reads as one key.',
  'not-found': 'Every row matched a song in Helm.'
};

interface SheetRowProps {
  r: KeyImportRow;
  height: number;
  chosen: MusicKeyRow | null;
  onCheck: (line: number, song: MusicKeyRow | null) => void;
  query: string;
  onQuery: (line: number, q: string) => void;
}

/** "Matched by title", or what a checked row will do, in plain words. */
function noteOf(r: KeyImportRow, chosen: MusicKeyRow | null): string {
  if (r.group === 'not-a-key') return PROBLEM_WORDS[r.problem ?? 'not-a-key'];
  if (r.group === 'different') {
    const helm = keyOf(r.candidates[0]);
    return chosen ? `Switches to ${r.key}` : `Keeps ${helm}`;
  }
  if (chosen && keyOf(chosen) === r.key) return `Already in ${r.key}`;
  if (r.group === 'ready') return r.by === 'ccli' ? 'Matched by CCLI number' : 'Matched by title';
  if (r.group === 'pick') return chosen ? '' : r.by === 'fuzzy' ? 'A close title: pick the song' : 'Pick the song';
  return chosen ? '' : 'Find the song by hand';
}

function SheetRow({ r, height, chosen, onCheck, query, onQuery }: SheetRowProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const on = !!chosen;
  const canCheck = r.group === 'ready' || r.group === 'different' || on;
  const toggle = (): void => {
    if (on) onCheck(r.line, null);
    else if (r.group === 'ready' || r.group === 'different') onCheck(r.line, r.candidates[0]);
  };
  const lineStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: '10px', height: `${LINE_H}px`, flexShrink: 0 };
  const keyCell =
    r.group === 'not-a-key' ? `“${r.cell}”` : r.group === 'different' ? `Helm: ${keyOf(r.candidates[0])} · Sheet: ${r.key}` : (r.key ?? '');
  const sheetTitle = r.title || (r.ccli ? `CCLI ${r.ccli}` : `Row ${r.line}`);
  const helmTitle = (r.group === 'ready' || r.group === 'different') && r.candidates[0].title.toLowerCase() !== r.title.toLowerCase() ? r.candidates[0].title : '';
  const choosing = r.group === 'pick' || r.group === 'not-found';
  return (
    <div
      style={{ height: `${height}px`, marginBottom: `${GAP}px`, padding: '0 10px', boxSizing: 'border-box', borderRadius: '8px', background: T.panel2, display: 'flex', flexDirection: 'column' }}
      data-sheet-row={r.line}
    >
      <div style={lineStyle}>
        <input
          type="checkbox"
          checked={on}
          disabled={!canCheck}
          onChange={toggle}
          aria-label={`Set the key of ${sheetTitle}`}
          style={{ width: '16px', height: '16px', flexShrink: 0, margin: 0, accentColor: T.accent, visibility: r.group === 'not-a-key' ? 'hidden' : 'visible' }}
        />
        <span style={{ ...clip, flex: 1, fontSize: '13px', color: on || r.group === 'not-a-key' || choosing ? T.text : T.dim }} title={sheetTitle}>
          {sheetTitle}
          {r.author && <span style={{ color: T.faint }}> · {r.author}</span>}
        </span>
        <span style={{ ...clip, width: r.group === 'different' ? '150px' : '90px', flexShrink: 0, fontFamily: MONO, fontSize: '12px', color: T.text }} data-sheet-key>
          {keyCell}
        </span>
        {r.group === 'not-found' ? (
          <input
            value={query}
            onChange={(e) => onQuery(r.line, e.target.value)}
            placeholder="Find the song in Helm…"
            aria-label={`Find ${sheetTitle} in Helm`}
            style={{ width: '220px', flexShrink: 0, height: '26px', padding: '0 9px', fontSize: '12.5px', borderRadius: '7px', background: T.inputBg, boxShadow: `inset 0 0 0 1px ${T.border}` }}
            data-sheet-find
          />
        ) : (
          <span style={{ ...clip, width: '220px', flexShrink: 0, fontSize: '12px', color: T.faint }} title={helmTitle}>
            {helmTitle && `In Helm: ${helmTitle}`}
          </span>
        )}
        <span style={{ ...clip, width: '170px', flexShrink: 0, fontSize: '12px', color: T.dim }} data-sheet-note>
          {noteOf(r, chosen)}
        </span>
      </div>
      {r.group === 'pick' && <Choices line={r.line} songs={r.candidates} chosen={chosen} onCheck={onCheck} />}
      {r.group === 'not-found' && <HandMatch line={r.line} query={query} chosen={chosen} onCheck={onCheck} />}
    </div>
  );
}

interface ChoicesProps {
  line: number;
  songs: MusicKeyRow[];
  chosen: MusicKeyRow | null;
  onCheck: (line: number, song: MusicKeyRow | null) => void;
}

/** Up to three songs as radio choices, each with its key now and its first line, so two
 * "Cornerstone"s can be told apart. Picking one checks the row. */
function Choices({ line, songs, chosen, onCheck }: ChoicesProps): JSX.Element {
  const T = useContext(ThemeCtx);
  return (
    <div style={{ display: 'flex', flexDirection: 'column', paddingLeft: '26px' }} role="radiogroup" data-sheet-choices>
      {songs.slice(0, 3).map((s) => {
        const key = keyOf(s);
        return (
          <label key={s.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', height: `${CHOICE_H}px`, fontSize: '12.5px', cursor: 'pointer' }} data-sheet-choice={s.id}>
            <input type="radio" name={`sheet-${line}`} checked={chosen?.id === s.id} onChange={() => onCheck(line, s)} style={{ margin: 0, accentColor: T.accent }} />
            <span style={{ ...clip, width: '260px', flexShrink: 0, color: T.text }}>{s.title}</span>
            <span style={{ ...clip, width: '170px', flexShrink: 0, color: T.faint }}>{s.author}</span>
            <span style={{ width: '64px', flexShrink: 0, fontFamily: MONO, fontSize: '11.5px', color: T.dim }}>{key ? `Key ${key}` : 'No key'}</span>
            <span style={{ ...clip, flex: 1, color: T.faint, fontStyle: 'italic' }}>{s.firstLine}</span>
          </label>
        );
      })}
    </div>
  );
}

interface HandMatchProps {
  line: number;
  query: string;
  chosen: MusicKeyRow | null;
  onCheck: (line: number, song: MusicKeyRow | null) => void;
}

/** Not found: a type-ahead over the library (the All tab's search), three songs at most. */
function HandMatch({ line, query, chosen, onCheck }: HandMatchProps): JSX.Element {
  const T = useContext(ThemeCtx);
  const [found, setFound] = useState<{ q: string; songs: MusicKeyRow[] }>({ q: '', songs: [] });
  const q = query.trim();
  useDebouncedSearch(q || null, line, (text, stillWanted) => {
    window.helm.songs
      .keyList({ tab: 'all', q: text })
      .then((songs) => {
        if (stillWanted()) setFound({ q: text, songs: songs.slice(0, 3) });
      })
      .catch(console.error);
  });
  const results = q && found.q === q ? found.songs : [];
  // The chosen song stays in view after the words change.
  const songs = chosen && !results.some((s) => s.id === chosen.id) ? [chosen, ...results].slice(0, 3) : results;
  if (!songs.length) {
    return (
      <div style={{ paddingLeft: '26px', height: `${CHOICE_H}px`, display: 'flex', alignItems: 'center', fontSize: '12.5px', color: T.faint }}>
        {q && found.q === q ? `No song in Helm matches “${q}”.` : 'Type a few words of the title to find it.'}
      </div>
    );
  }
  return <Choices line={line} songs={songs} chosen={chosen} onCheck={onCheck} />;
}
