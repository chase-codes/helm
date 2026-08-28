// Scenario-driven labeled query set for the song-search spike, organized by the
// operator intents mapped in Step 0. `target` is a corpus key; `field` is the UI
// tab the operator would realistically have active. `weight` reflects how often /
// how critically the intent occurs in a live service (used to weight metrics).
import type { SearchField } from '../../src/shared/types';

export type Intent =
  | 'known-title-pressure'   // audible called, types known title, Enter takes top hit
  | 'forgot-title-lyric'     // remembers a lyric line, not the title
  | 'misspelled-title'       // knows title, fat-fingers it
  | 'wrong-word-order'       // title words out of order / partial rearrangement
  | 'inflected-form'         // praise vs praising, etc.
  | 'accented-text'          // multilingual / diacritics
  | 'audible-partial'        // very short prefix under time pressure
  | 'author-recall';         // knows the artist, not the title

export interface LabeledQuery {
  intent: Intent;
  q: string;
  field: SearchField;
  target: string; // corpus key the operator expects cued at rank 1
  note?: string;
}

// Intent weights: relative frequency-x-criticality in a live service (Step 0 ranking).
// Sums are normalized in the harness; absolute values are what matters relatively.
export const INTENT_WEIGHT: Record<Intent, number> = {
  'known-title-pressure': 5, // the dominant, most time-critical case
  'audible-partial': 4,
  'forgot-title-lyric': 3,
  'misspelled-title': 3,
  'wrong-word-order': 2,
  'inflected-form': 1,
  'accented-text': 1,
  'author-recall': 1,
};

export const QUERIES: LabeledQuery[] = [
  // --- known-title-under-pressure: full/near-full title, expect rank 1 ---
  { intent: 'known-title-pressure', q: 'amazing grace', field: 'all', target: 'amazing-grace' },
  { intent: 'known-title-pressure', q: 'how great thou art', field: 'all', target: 'how-great-thou-art' },
  { intent: 'known-title-pressure', q: 'how great is our god', field: 'all', target: 'how-great-is-our-god',
    note: 'collides with How Great Thou Art on leading words' },
  { intent: 'known-title-pressure', q: 'goodness of god', field: 'all', target: 'goodness-of-god' },
  { intent: 'known-title-pressure', q: 'way maker', field: 'all', target: 'way-maker' },
  { intent: 'known-title-pressure', q: 'in christ alone', field: 'all', target: 'in-christ-alone' },
  { intent: 'known-title-pressure', q: 'it is well', field: 'all', target: 'it-is-well' },
  { intent: 'known-title-pressure', q: 'good good father', field: 'all', target: 'good-good-father' },
  { intent: 'known-title-pressure', q: 'king of kings', field: 'all', target: 'king-of-kings' },
  { intent: 'known-title-pressure', q: 'reckless love', field: 'title', target: 'reckless-love' },

  // --- audible-partial: short prefix, operator in a hurry ---
  { intent: 'audible-partial', q: 'ocea', field: 'all', target: 'oceans' },
  { intent: 'audible-partial', q: 'way m', field: 'all', target: 'way-maker' },
  { intent: 'audible-partial', q: 'what a beau', field: 'all', target: 'what-a-beautiful-name' },
  { intent: 'audible-partial', q: 'grave', field: 'all', target: 'graves-into-gardens' },
  { intent: 'audible-partial', q: 'cornerst', field: 'all', target: 'cornerstone' },
  { intent: 'audible-partial', q: '10000', field: 'all', target: '10000-reasons',
    note: 'W8 (#122 fixed): norm() joins the digit-group comma; whole-word "10000" wins the title band' },
  { intent: 'audible-partial', q: 'o come to the alt', field: 'all', target: 'o-come-to-the-altar' },
  { intent: 'audible-partial', q: 'no longer', field: 'all', target: 'no-longer-slaves' },

  // --- forgot-title, remember a lyric line ---
  { intent: 'forgot-title-lyric', q: 'spirit lead me where my trust is without borders', field: 'all', target: 'oceans' },
  { intent: 'forgot-title-lyric', q: 'bless the lord o my soul', field: 'all', target: '10000-reasons' },
  { intent: 'forgot-title-lyric', q: 'i am no longer a slave to fear', field: 'lyric', target: 'no-longer-slaves' },
  { intent: 'forgot-title-lyric', q: 'you turn mourning to dancing', field: 'all', target: 'graves-into-gardens' },
  { intent: 'forgot-title-lyric', q: 'morning by morning new mercies', field: 'all', target: 'great-is-thy-faithfulness' },
  { intent: 'forgot-title-lyric', q: 'crimson stain', field: 'all', target: 'jesus-paid-it-all' },
  { intent: 'forgot-title-lyric', q: 'the things of earth will grow strangely dim', field: 'lyric', target: 'turn-your-eyes' },
  { intent: 'forgot-title-lyric', q: 'my chains are gone', field: 'all', target: 'amazing-grace',
    note: 'common modern refrain NOT in our classic Amazing Grace text — expected miss / stress case' },

  // --- misspelled-title (typos) ---
  { intent: 'misspelled-title', q: 'amazin grace', field: 'all', target: 'amazing-grace' },
  { intent: 'misspelled-title', q: 'reckles love', field: 'all', target: 'reckless-love' },
  { intent: 'misspelled-title', q: 'goodnes of god', field: 'all', target: 'goodness-of-god' },
  { intent: 'misspelled-title', q: 'cornerstoen', field: 'all', target: 'cornerstone' },
  { intent: 'misspelled-title', q: 'how geat thou art', field: 'all', target: 'how-great-thou-art' },
  { intent: 'misspelled-title', q: 'blesed assurance', field: 'all', target: 'blessed-assurance' },
  { intent: 'misspelled-title', q: 'faithfullness', field: 'all', target: 'great-is-thy-faithfulness',
    note: 'single-token typo, long word' },
  { intent: 'misspelled-title', q: 'graev into gardens', field: 'all', target: 'graves-into-gardens' },

  // --- wrong word order ---
  { intent: 'wrong-word-order', q: 'grace amazing', field: 'all', target: 'amazing-grace' },
  { intent: 'wrong-word-order', q: 'god goodness of', field: 'all', target: 'goodness-of-god' },
  { intent: 'wrong-word-order', q: 'kings king of', field: 'all', target: 'king-of-kings' },
  { intent: 'wrong-word-order', q: 'love reckless', field: 'all', target: 'reckless-love' },

  // --- inflected forms ---
  { intent: 'inflected-form', q: 'praising my saviour', field: 'all', target: 'blessed-assurance',
    note: 'lyric says "Praising my Saviour"; base form "praise"' },
  { intent: 'inflected-form', q: 'sing goodness', field: 'all', target: 'goodness-of-god',
    note: 'lyric "I will sing of the goodness"' },
  { intent: 'inflected-form', q: 'trading sorrow', field: 'all', target: 'trading-my-sorrows',
    note: 'title/lyric plural "sorrows"' },

  // --- accented / multilingual ---
  { intent: 'accented-text', q: 'cuan grande', field: 'all', target: 'cuan-grande',
    note: 'query unaccented, title "Cuán Grande Es Él"' },
  { intent: 'accented-text', q: 'renuevame', field: 'all', target: 'renuevame',
    note: 'query unaccented, title "Renuévame"' },
  { intent: 'accented-text', q: 'sublime gracia', field: 'all', target: 'sublime-gracia' },
  { intent: 'accented-text', q: 'grosser gott', field: 'all', target: 'grosser-gott',
    note: 'German ß in "Großer Gott"' },
  { intent: 'accented-text', q: 'senor', field: 'lyric', target: 'sublime-gracia',
    note: 'lyric "Señor" — unaccented query should still hit' },

  // --- Adversarial additions (2026-08-27 accuracy investigation) ---
  { intent: 'misspelled-title', q: 'praise recukless', field: 'all', target: 'reckless-love',
    note: 'W1: an exactly-matched common word must not beat the near-matched rare one' },
  { intent: 'misspelled-title', q: 'holy reckelss', field: 'all', target: 'reckless-love',
    note: 'W1 companion (the original #13 shape, now comparator-bound)' },
  { intent: 'audible-partial', q: 'art', field: 'all', target: 'how-great-thou-art',
    note: 'W3: word-interior substring ("Heart", "Departed") must not outrank the word-start match' },
  { intent: 'audible-partial', q: 'son', field: 'all', target: 'son-of-god',
    note: 'W3: "Person of Peace" word-interior trap' },
  { intent: 'audible-partial', q: 'well', field: 'all', target: 'wellspring',
    note: 'W3: word-START "Wellspring" is legitimate type-ahead; "Farewell" is not' },
  { intent: 'forgot-title-lyric', q: 'give me your hand', field: 'all', target: 'take-my-hand',
    note: 'W2: the user-reported stopword-fuzz bug; also replayed per-keystroke in stability.test.ts' },
  { intent: 'author-recall', q: 'asbury worship', field: 'all', target: 'reckless-love',
    note: 'W6 (#121 fixed): rare-token idf tie-break — the exact author match wins the partial band' },
];
