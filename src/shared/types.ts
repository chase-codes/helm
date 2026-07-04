import type { MessageImportResult } from './message/parseImport';
import type { TapeRow, QuoteRow } from './search/messageScore';

export interface SongSection { label: string; lines: string[] }
export interface Song {
  id: string; title: string; author: string;
  sections: SongSection[]; source: string; createdAt: number;
}
export interface SongSearchResult { song: Song; score: number; snippet: string }
export type SearchField = 'all' | 'title' | 'lyric';
export interface NewSongInput { title: string; author?: string; text: string; source?: string }

export type SlideKind =
  | 'lyrics' | 'scripture' | 'quote' | 'title' | 'sermon'
  | 'countdown' | 'logo' | 'black' | 'blank' | 'reading' | 'image';
export interface SlideColumn { version: string; text: string }
export interface Slide {
  kind: SlideKind; accent?: string; label?: string; lines?: string[];
  ref?: string; columns?: SlideColumn[]; text?: string; source?: string;
  title?: string; subtitle?: string; points?: string[];
  message?: string; countdownText?: string; bg?: string; src?: string;
  paras?: { label: string; text: string }[]; activeOrd?: number;
}

export type OutputMode = 'live' | 'logo' | 'black';
export interface PresentationState {
  output: OutputMode; liveKey: string | null; liveSnap: Slide | null;
}
export type OutputVariant = 'audience' | 'main' | 'stage' | 'leader' | 'livestream';
export interface OutputPayload { slide: Slide; variant: OutputVariant }
export interface DisplayStatus { outputs: number }

export const CH = {
  songsSearch: 'songs:search', songsList: 'songs:list',
  songsGet: 'songs:get', songsAdd: 'songs:add',
  presGet: 'presentation:get', presCue: 'presentation:cue',
  presGoLive: 'presentation:goLive', presSetOutput: 'presentation:setOutput',
  presState: 'presentation:state',           // main → all windows
  outputSlide: 'output:slide',               // main → output windows
  displaysGet: 'displays:get', displaysStatus: 'displays:status',
  displaysOpenTest: 'displays:openTest',
  biblesManifest: 'bibles:manifest', biblesInstall: 'bibles:install',
  biblesUninstall: 'bibles:uninstall',
  biblesProgress: 'bibles:progress',  // main → all windows
  biblesGetChapter: 'bibles:getChapter',
  biblesBookExtent: 'bibles:bookExtent',
  scheduleList: 'schedule:list', scheduleAdd: 'schedule:add',
  settingsGet: 'settings:get', settingsSet: 'settings:set',
  messageSearch: 'message:search', messageList: 'message:list', messageGet: 'message:get',
  messageInstallCorpus: 'message:installCorpus', messageImportParse: 'message:importParse',
  messageImportSave: 'message:importSave', messageDownloadAudio: 'message:downloadAudio',
  messageTiming: 'message:timing',
  messageInstallProgress: 'message:installProgress',   // main → all
  messageAudioProgress: 'message:audioProgress',        // main → all
  quoteScheduleList: 'quoteSchedule:list', quoteScheduleAdd: 'quoteSchedule:add',
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
  };
  presentation: {
    get(): Promise<PresentationState>;
    cue(key: string, slide: Slide): void;
    goLive(key: string, slide: Slide): void;
    setOutput(mode: OutputMode): void;
    onState(cb: (s: PresentationState) => void): () => void;
  };
  output: { onSlide(cb: (p: OutputPayload) => void): () => void };
  displays: {
    get(): Promise<DisplayStatus>;
    onStatus(cb: (d: DisplayStatus) => void): () => void;
    openTest(): void;
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
  };
}
