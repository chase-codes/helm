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
  | 'countdown' | 'logo' | 'black' | 'blank';
export interface SlideColumn { version: string; text: string }
export interface Slide {
  kind: SlideKind; accent?: string; label?: string; lines?: string[];
  ref?: string; columns?: SlideColumn[]; text?: string; source?: string;
  title?: string; subtitle?: string; points?: string[];
  message?: string; countdownText?: string; bg?: string;
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
} as const;

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
}
