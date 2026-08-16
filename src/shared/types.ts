import type { MessageImportResult } from './message/parseImport';
import type { TapeRow, QuoteRow } from './search/messageScore';

export interface SongSection { label: string; lines: string[] }
export interface Song {
  id: string; title: string; author: string;
  sections: SongSection[]; source: string; createdAt: number;
  /** Musical key, e.g. "G", "Bb", "F#m". Absent when not set. */
  key?: string;
}
export interface SongSearchResult { song: Song; score: number; snippet: string }
export type SearchField = 'all' | 'title' | 'lyric';
export interface NewSongInput { title: string; author?: string; text: string; source?: string; key?: string }
export interface UpdateSongInput { title: string; author?: string; key?: string; sections: SongSection[] }
export interface SongWebCandidate {
  title: string; author: string;
  text: string;              // tidied + chorus-labeled — display-ready
  album?: string; duration?: number;
}
export type SongWebSearchResult = { candidates: SongWebCandidate[] } | { error: 'network' };
export type SongFromUrlResult =
  | { candidate: SongWebCandidate }
  | { error: 'network' | 'bad-url' | 'no-lyrics' };

export type SlideKind =
  | 'lyrics' | 'scripture' | 'quote' | 'title' | 'sermon'
  | 'logo' | 'black' | 'blank' | 'reading' | 'image' | 'video';
export interface SlideColumn { version: string; text: string }
export interface Slide {
  kind: SlideKind; accent?: string; label?: string; lines?: string[];
  ref?: string; columns?: SlideColumn[]; text?: string; source?: string;
  title?: string; subtitle?: string; points?: string[];
  bg?: string; src?: string;
  paras?: { label: string; text: string }[]; activeOrd?: number;
  /** Lyrics only: bare section label ("Verse 1") and song key ("G") for view-side chrome.
   *  `label` above stays the pre-baked "Title · Section" string stage/livestream render. */
  sectionLabel?: string; songKey?: string;
}

export type PreCardType = 'message' | 'verse' | 'list' | 'logo' | 'image';
export interface PreCard {
  id: string; type: PreCardType; title: string; enabled: boolean;
  headline?: string; subtitle?: string;      // message
  ref?: string; text?: string; version?: string;   // verse
  points?: string[];                         // list
  src?: string;                              // image (helm-media:// url)
}

export type MediaItemType = 'image' | 'deck' | 'video';
export interface MediaItem {
  id: string;
  type: MediaItemType;
  title: string;
  filePath: string | null; // relative to library/, for image|video; null for deck
  slides: string[]; // relative image paths, for deck (empty otherwise)
  createdAt: number;
}
export interface MediaImportProgress {
  phase: 'converting' | 'rasterizing';
  page?: number;
  pageCount?: number;
}
export interface MediaImportResult {
  items: MediaItem[];
  canceled?: boolean;
  error?: 'no-libreoffice';
}

export interface ScannedSong {
  title: string;
  author: string;
  text: string;
  /** The slide count the source itself reports, present only when it disagrees with what the
   *  adapter's own parse produced. A song to look at, not a song to drop. */
  sourceStanzas?: number;
  /** Our own slide count for this song, on the same EasyWorship-faithful basis as
   *  `sourceStanzas` — present only when the two disagree. */
  parsedStanzas?: number;
}
export interface UnreadableSong { title: string; reason: string }
export interface ScanOutcome {
  songs: ScannedSong[];
  unreadable: UnreadableSong[];
  /** How many songs carry a laid-out slide set in the source. Absent means the source cannot
   *  say — never zero. This is the measurement that decides whether importing those exact
   *  layouts is worth building. */
  withLayouts?: number;
}
export interface ImportSourceInfo { id: string; label: string }
export type Located = { path: string };
export type LocateFailure = {
  error:
    | 'no-source-files'
    | 'canceled'
    | 'all-candidates-empty'
    | 'candidates-unreadable'
    /** The picked folder was too broad to search fully (a drive root, a whole user profile):
     *  the walk hit its directory-visit budget before it could finish, and found nothing along
     *  the way. Distinct from `no-source-files`, which means the walk finished and genuinely
     *  found nothing — this means the walk never finished. */
    | 'search-too-broad';
  expected?: string;
};
export type LocateResult = Located | LocateFailure;

export interface ImportReviewRow {
  title: string;
  author: string;
  stanzas: number;
  status: 'new' | 'duplicate' | 'unreadable';
  reason?: string;
  /** The source's own slide count, present only when it disagrees with ours. Orthogonal to
   *  `status`: a song can be `new` and still be worth a second look. The adapter sets this and
   *  `parsedStanzas` as a pair — always both present or both absent — but each is independently
   *  optional in this type, so a renderer must check both before trusting either is there. */
  sourceStanzas?: number;
  /** Our own slide count for this song, on the same basis as `sourceStanzas` — present only
   *  when the two disagree. This, not `stanzas`, is the number to render beside `sourceStanzas`
   *  in a CHECK badge: `stanzas` excludes empty slides and is not the number that was compared.
   *  The adapter sets this and `sourceStanzas` as a pair — always both present or both absent —
   *  but each is independently optional in this type, so a renderer must check both before
   *  trusting either is there. */
  parsedStanzas?: number;
}
export interface SongImportScan {
  token: string;
  rows: ImportReviewRow[];
  /** How many songs carry a laid-out slide set in the source, when the source can say. */
  withLayouts?: number;
}
export type SongImportScanResult = SongImportScan | LocateFailure | { error: 'unknown-source' };
export interface SongImportResult {
  imported: number;
  skipped: number;
  unreadable: { title: string; reason: string }[];
}
export interface SongImportProgress { done: number; total: number }

export type OutputMode = 'live' | 'logo' | 'black';
export interface PresentationState {
  output: OutputMode; liveKey: string | null; liveSnap: Slide | null;
  cuedKey: string | null; cuedSnap: Slide | null;
}
export interface VideoStateWire {
  key: string | null; src: string | null;
  playing: boolean; positionMs: number; durationMs: number;
  volume: number; muted: boolean;
}
export type OutputVariant = 'audience' | 'main' | 'stage' | 'leader' | 'livestream';
export type OutputRole = 'audience' | 'stage' | 'livestream' | 'off';  // declared here; roles.ts imports it
export type OutputViewMode = 'slides' | 'leader' | 'mirror';
export interface OutputPayload { slide: Slide; variant: OutputVariant; view: OutputViewMode; leaderSplit?: number }
export interface DisplayInfo {
  id: number;
  fingerprint: string;
  label: string;            // human label or '' — 6b shows resolution when empty
  width: number;            // logical size.width
  height: number;           // logical size.height
  scaleFactor: number;      // 6b renders "1920×1080 @2x" from size + scaleFactor
  role: OutputRole | null;  // null for the operator display (not an output)
  isOperator: boolean;
  view: OutputViewMode | null;  // resolved view for outputs; null for the operator display
  leaderSplit: number | null;   // rail px for the leader view; null for the operator display
}
export interface DisplayStatus { outputs: number; displays: DisplayInfo[]; released: boolean }

export type UpdateState =
  | 'idle' | 'available' | 'ready'          // background-visible
  | 'checking' | 'downloading'              // manual-only
  | 'upToDate' | 'error' | 'unsupported'    // manual-only, terminal
export interface UpdateStatus {
  state: UpdateState
  version: string | null
  percent?: number   // downloading only
  message?: string   // error only
}

export const CH = {
  songsSearch: 'songs:search', songsList: 'songs:list',
  songsGet: 'songs:get', songsAdd: 'songs:add', songsUpdate: 'songs:update',
  songsRemove: 'songs:remove',
  presGet: 'presentation:get', presCue: 'presentation:cue',
  presGoLive: 'presentation:goLive', presShow: 'presentation:show',
  presTake: 'presentation:take',
  presSetOutput: 'presentation:setOutput',
  presState: 'presentation:state',           // main → all windows
  outputSlide: 'output:slide',               // main → output windows
  displaysGet: 'displays:get', displaysStatus: 'displays:status',
  displaysOpenTest: 'displays:openTest', displaysSetRole: 'displays:setRole',
  displaysSetView: 'displays:setView',
  displaysSetLeaderSplit: 'displays:setLeaderSplit',
  displaysToggleReleased: 'displays:toggleReleased',
  biblesManifest: 'bibles:manifest', biblesInstall: 'bibles:install',
  biblesUninstall: 'bibles:uninstall',
  biblesProgress: 'bibles:progress',  // main → all windows
  biblesGetChapter: 'bibles:getChapter',
  biblesBookExtent: 'bibles:bookExtent',
  scheduleList: 'schedule:list', scheduleAdd: 'schedule:add', scheduleRemove: 'schedule:remove',
  scheduleRemoveMany: 'schedule:removeMany',
  settingsGet: 'settings:get', settingsSet: 'settings:set',
  messageSearch: 'message:search', messageList: 'message:list', messageGet: 'message:get',
  messageInstallCorpus: 'message:installCorpus', messageImportParse: 'message:importParse',
  messageImportSave: 'message:importSave', messageDownloadAudio: 'message:downloadAudio',
  messageTiming: 'message:timing',
  messageInstallProgress: 'message:installProgress',   // main → all
  messageAudioProgress: 'message:audioProgress',        // main → all
  quoteScheduleList: 'quoteSchedule:list', quoteScheduleAdd: 'quoteSchedule:add',
  quoteScheduleRemove: 'quoteSchedule:remove', quoteScheduleRemoveMany: 'quoteSchedule:removeMany',
  preserviceGetState: 'preservice:getState', preserviceState: 'preservice:state',   // main → all windows
  preserviceEngage: 'preservice:engage', preserviceDisengage: 'preservice:disengage',
  preserviceShow: 'preservice:show', preserviceStep: 'preservice:step',
  preserviceShowNow: 'preservice:showNow',
  preserviceTake: 'preservice:takeCard',
  preserviceToggleLoop: 'preservice:toggleLoop', preserviceSetDwell: 'preservice:setDwell',
  preserviceToggleEnabled: 'preservice:toggleEnabled', preserviceSaveCard: 'preservice:saveCard',
  preserviceRemoveCard: 'preservice:removeCard',
  preserviceRestoreCard: 'preservice:restoreCard',
  mediaList: 'media:list', mediaImportImages: 'media:importImages',
  mediaImportVideo: 'media:importVideo', mediaImportDeck: 'media:importDeck',
  mediaRemove: 'media:remove', mediaImportProgress: 'media:importProgress',
  videoGetState: 'video:getState', videoState: 'video:state',   // main → all windows
  videoLoad: 'video:load', videoPlay: 'video:play', videoPause: 'video:pause',
  videoSeek: 'video:seek', videoSetVolume: 'video:setVolume',
  videoSetMuted: 'video:setMuted', videoReportDuration: 'video:reportDuration',
  songImportSources: 'songImport:sources', songImportScan: 'songImport:scan',
  songImportCommit: 'songImport:commit', songImportProgress: 'songImport:progress',
  songSourcesSearch: 'songSources:search', songSourcesFromUrl: 'songSources:fromUrl',
  updatesGetStatus: 'updates:getStatus', updatesInstall: 'updates:install',
  updatesCheck: 'updates:check',
  updatesStatus: 'updates:status',           // main → all windows
  appGetVersion: 'app:getVersion',
} as const;

export interface InstalledVersion { id: string; abbr: string; name: string; language: string }
export interface ChapterData {
  book: string; chapter: number; verseCount: number;
  verses: Record<number, Record<string, string>>;
}
export interface BookExtent { chapters: number; verseCounts: number[] } // verseCounts[chapterIndex0] = verses in chapter (index+1)
export interface ScriptureReading { id: string; book: string; ch: number; from: number; to: number }
export interface NormalizedBible {
  id: string; abbr: string; name: string; language: string;
  books: { name: string; chapters: { n: number; verses: { n: number; text: string }[] }[] }[];
}

export interface BibleManifestEntry { id: string; abbr: string; name: string; bundled?: boolean; installed: boolean }
export interface BibleInstallProgress {
  id: string; phase: 'downloading' | 'installing' | 'done' | 'error'; error?: string;
}

export interface MessageParagraph { ord: number; label: string; text: string }
export interface Message {
  id: string; tapeNo: string; title: string; date: string;
  durationS: number; audioPath: string | null; source: string;
  paragraphs: MessageParagraph[];
}
export interface TimingSpan { ord: number; tStart: number; tEnd: number }
export type TimingMap = TimingSpan[];
export interface MessageMeta { id: string; tapeNo: string; title: string; date: string; durationS: number; hasAudio: boolean }

export interface MessageInstallProgress {
  phase: 'downloading' | 'installing' | 'done' | 'error'; count?: number; total?: number; error?: string;
}
export interface AudioDownloadProgress {
  msgId: string; phase: 'downloading' | 'done' | 'error'; received?: number; total?: number; error?: string;
}

export interface QuoteScheduleItem { id: string; msgId: string; ord: number; label: string; tapeNo: string; title: string }

export interface PreState {
  engaged: boolean; loopOn: boolean; idx: number; dwellS: number; cards: PreCard[];
}

// Re-exports so consumers can pull these API-surface types from '../shared/types' alongside
// everything else, without a separate import path. The source modules do not import from
// this file, so this re-export is one-way and does not create an import cycle.
export type { MessageImportResult } from './message/parseImport';
export type { TapeRow, QuoteRow } from './search/messageScore';

export interface HelmApi {
  songs: {
    search(q: string, field: SearchField): Promise<SongSearchResult[]>;
    list(): Promise<Song[]>;
    get(id: string): Promise<Song | null>;
    add(input: NewSongInput): Promise<Song>;
    update(id: string, input: UpdateSongInput): Promise<Song>;
    /** Permanent — the library is not a schedule, so this is the one in-service list
     * action that confirms instead of offering an undo (#90). */
    remove(id: string): Promise<Song[]>;
  };
  presentation: {
    get(): Promise<PresentationState>;
    cue(key: string, slide: Slide): void;
    goLive(key: string, slide: Slide): void;
    show(key: string, slide: Slide): void;
    /** Idempotent take-the-screen (double-click). Never blacks the output — see takeLive. */
    take(key: string, slide: Slide): void;
    setOutput(mode: OutputMode): void;
    onState(cb: (s: PresentationState) => void): () => void;
  };
  output: { onSlide(cb: (p: OutputPayload) => void): () => void };
  displays: {
    get(): Promise<DisplayStatus>;
    onStatus(cb: (d: DisplayStatus) => void): () => void;
    openTest(): void;
    setRole(fingerprint: string, role: OutputRole): void;
    setView(fingerprint: string, view: OutputViewMode): void;
    setLeaderSplit(fingerprint: string | null, px: number): void;
    toggleReleased(): void;
  };
  bibles: {
    manifest(): Promise<BibleManifestEntry[]>;
    install(id: string): void;                       // async; progress via onProgress
    uninstall(id: string): Promise<BibleManifestEntry[]>;
    getChapter(book: string, chapter: number): Promise<ChapterData>;
    bookExtent(book: string): Promise<BookExtent>;
    onProgress(cb: (p: BibleInstallProgress) => void): () => void;
  };
  schedule: {
    list(): Promise<ScriptureReading[]>;
    add(r: Omit<ScriptureReading, 'id'>): Promise<ScriptureReading[]>;
    remove(id: string): Promise<ScriptureReading[]>;
    removeMany(ids: string[]): Promise<ScriptureReading[]>;
  };
  settings: {
    get<T>(key: string, fallback: T): Promise<T>;
    set(key: string, value: unknown): void;
  };
  message: {
    search(q: string, scope: string | null): Promise<{ tapes: TapeRow[]; quotes: QuoteRow[] }>;
    list(): Promise<MessageMeta[]>;
    get(id: string): Promise<Message | null>;
    installCorpus(): void;
    importParse(kind: 'txt' | 'pdf', data: string): Promise<MessageImportResult>;
    importSave(r: MessageImportResult): Promise<MessageMeta[]>;
    downloadAudio(id: string): void;
    timing(id: string): Promise<TimingMap>;
    onInstallProgress(cb: (p: MessageInstallProgress) => void): () => void;
    onAudioProgress(cb: (p: AudioDownloadProgress) => void): () => void;
  };
  quoteSchedule: {
    list(): Promise<QuoteScheduleItem[]>;
    add(msgId: string, ord: number): Promise<QuoteScheduleItem[]>;
    remove(id: string): Promise<QuoteScheduleItem[]>;
    removeMany(ids: string[]): Promise<QuoteScheduleItem[]>;
  };
  preservice: {
    getState(): Promise<PreState>;
    onState(cb: (s: PreState) => void): () => void;
    engage(): void; disengage(): void;
    showCard(idx: number): void; step(dir: 1 | -1): void;
    showNow(): void;
    takeCard(idx: number): void;
    toggleLoop(): void; setDwell(delta: number): void;
    toggleEnabled(id: string): void;
    saveCard(c: Omit<PreCard, 'id'> & { id?: string }): void;
    removeCard(id: string): void;
    /** Undo for removeCard: re-inserts the card at `index` with its original id, so the
     * rotation comes back in the order the operator built (#86). */
    restoreCard(card: PreCard, index: number): void;
  };
  media: {
    list(): Promise<MediaItem[]>;
    importImages(): Promise<MediaImportResult>;
    importVideo(): Promise<MediaImportResult>;
    importDeck(): Promise<MediaImportResult>;
    remove(id: string): Promise<MediaItem[]>;
    onImportProgress(cb: (p: MediaImportProgress) => void): () => void;
  };
  video: {
    get(): Promise<VideoStateWire>;
    onState(cb: (s: VideoStateWire) => void): () => void;
    load(key: string, src: string): void;
    play(): void; pause(): void;
    seek(ms: number): void;
    setVolume(v: number): void; setMuted(m: boolean): void;
    reportDuration(ms: number): void;
  };
  songImport: {
    sources(): Promise<ImportSourceInfo[]>;
    scan(sourceId: string): Promise<SongImportScanResult>;
    commit(token: string): Promise<SongImportResult>;
    onProgress(cb: (p: SongImportProgress) => void): () => void;
  };
  songSources: {
    search(query: string): Promise<SongWebSearchResult>;
    fromUrl(url: string): Promise<SongFromUrlResult>;
  };
  updates: {
    getStatus(): Promise<UpdateStatus>;
    check(): Promise<void>;
    install(): Promise<boolean>;
    onStatus(cb: (s: UpdateStatus) => void): () => void;
  };
  app: {
    version(): Promise<string>;
  };
}
