import { useEffect, useRef, useState, type CSSProperties, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { activeOrdAt } from '../../shared/message/timing';
import type { Theme } from '../../shared/theme';
import type { Message, TimingMap } from '../../shared/types';

export interface TapePlayerProps {
  theme: Theme;
  msg: Message;
  /** Playable `file://` URL once the tape's audio has been downloaded, else null —
   * pressing play in that state triggers `onEnsureAudio` instead of playback. */
  audioSrc: string | null;
  /** Empty in slice 4 (aeneas alignment lands in 4b — see
   * docs/superpowers/notes/2026-07-03-the-table-acquisition.md); `activeOrdAt` degrades
   * to always-0 against an empty map, so the reading view simply doesn't auto-scroll
   * yet. Wired correctly here so it "just works" once 4b populates timing. */
  timing: TimingMap;
  /** True while a download this player triggered is in flight (owned by MessageMode,
   * which also clears it on `onAudioProgress` done/error). */
  downloading: boolean;
  /** Fired only when the computed paragraph ord actually changes (deduped internally
   * against the previous value) — never once per `timeupdate` tick. */
  onActiveOrd: (ord: number) => void;
  /** Requests the on-demand download (`message.downloadAudio`); called instead of
   * playing when `audioSrc` is still null. */
  onEnsureAudio: () => void;
}

function fmt2(n: number): string {
  return (n < 10 ? '0' : '') + n;
}

/** mm:ss (h:mm:ss past an hour) — ported character-exact from Lectern.pretty.html's
 * `fmtDur`/`fmt2` (lines 993/1069). */
function fmtDur(s: number): string {
  const total = Math.max(0, Math.floor(s));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  return (h ? `${h}:${fmt2(m)}` : `${m}`) + ':' + fmt2(sec);
}

/** The Message track's tape-player card: circular play/pause, title + elapsed/total
 * time, and a seekable progress bar. Ported character-exact from
 * Lectern.pretty.html:268-280 (styles 1308-1313). Mounted by MessageMode into
 * MessageSearchRail's `tapePlayer` slot; MessageMode owns fetching `timing`,
 * subscribing to `onAudioProgress`, and re-cueing the reading slide from
 * `onActiveOrd` — this component only knows about the `<audio>` element and the
 * dedupe-on-change ord callback. */
export function TapePlayer({ theme: T, msg, audioSrc, timing, downloading, onActiveOrd, onEnsureAudio }: TapePlayerProps): JSX.Element {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  // -1 (not a real ord) so the very first computed ord — usually 0 — still fires once,
  // cueing the reading slide as soon as playback starts rather than waiting for a
  // boundary crossing that may be seconds away.
  const lastOrdRef = useRef(-1);
  // Set when play is pressed before audio is downloaded; consumed once `audioSrc`
  // arrives so playback starts without a second button press.
  const pendingPlayRef = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [pos, setPos] = useState(0);

  useEffect(() => {
    if (!audioSrc || !pendingPlayRef.current) return;
    pendingPlayRef.current = false;
    const a = audioRef.current;
    if (!a) return;
    void a
      .play()
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
  }, [audioSrc]);

  const handleTimeUpdate = (): void => {
    const a = audioRef.current;
    if (!a) return;
    setPos(a.currentTime);
    const ord = activeOrdAt(timing, a.currentTime);
    if (ord !== lastOrdRef.current) {
      lastOrdRef.current = ord;
      onActiveOrd(ord);
    }
  };

  const togglePlay = (): void => {
    if (downloading) return;
    if (!audioSrc) {
      pendingPlayRef.current = true;
      onEnsureAudio();
      return;
    }
    const a = audioRef.current;
    if (!a) return;
    if (playing) {
      a.pause();
      setPlaying(false);
    } else {
      void a
        .play()
        .then(() => setPlaying(true))
        .catch(() => setPlaying(false));
    }
  };

  const seek = (e: ReactMouseEvent<HTMLDivElement>): void => {
    const bar = barRef.current;
    const a = audioRef.current;
    if (!bar || !a || !audioSrc || !msg.durationS) return;
    const rect = bar.getBoundingClientRect();
    const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    a.currentTime = frac * msg.durationS;
    setPos(a.currentTime);
  };

  const duration = msg.durationS;
  const shownPos = Math.min(pos, duration);
  const fillPct = duration > 0 ? Math.min(100, (shownPos / duration) * 100) : 0;

  const tapeCardStyle: CSSProperties = { margin: '0 12px 12px', padding: '11px 12px', borderRadius: '12px', background: T.panel2, boxShadow: 'inset 0 0 0 1px ' + T.hairline, flexShrink: 0 };
  const tapeBtnStyle: CSSProperties = { width: '34px', height: '34px', borderRadius: '50%', background: T.message + '22', color: T.message, fontSize: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: 'inset 0 0 0 1px ' + T.message + '55', cursor: downloading ? 'default' : 'pointer', opacity: downloading ? 0.6 : 1 };
  const tapeBarStyle: CSSProperties = { height: '4px', borderRadius: '2px', background: T.panel3, marginTop: '10px', overflow: 'hidden', cursor: audioSrc ? 'pointer' : 'default' };
  const tapeFillStyle: CSSProperties = { height: '100%', width: `${fillPct.toFixed(1)}%`, background: T.message, transition: 'width 1s linear' };

  const tapeBtnLabel = playing ? '❚❚' : '▶';
  const tapeTime = downloading ? 'Downloading…' : `${fmtDur(shownPos)} / ${fmtDur(duration)}`;

  return (
    <div style={tapeCardStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <button style={tapeBtnStyle} onClick={togglePlay}>
          {tapeBtnLabel}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 600, fontSize: '12.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg.title}</div>
          <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: '10.5px', color: T.faint, marginTop: '2px' }}>{tapeTime}</div>
        </div>
      </div>
      <div ref={barRef} style={tapeBarStyle} onClick={seek}>
        <div style={tapeFillStyle} />
      </div>
      <audio ref={audioRef} src={audioSrc ?? undefined} onTimeUpdate={handleTimeUpdate} onEnded={() => setPlaying(false)} />
    </div>
  );
}
