// Throwaway corpus for the song-search spike. NOT production code.
// ~50 curated real-ish worship songs (the labeled search targets) + synthetic
// filler to reach a realistic library size and create FTS prefix-collision
// pressure (many titles sharing a leading word) for the >=30 fallback probe.
import type { NewSongInput } from '../../src/shared/types';

export interface CorpusSong extends NewSongInput {
  key: string; // stable handle used by the labeled query set
}

// --- Curated targets: well-known hymns + contemporary worship, a few multilingual ---
// Choruses are repeated verbatim (as an operator's pasted song would be) so lyric
// term frequency is realistic.
export const CURATED: CorpusSong[] = [
  { key: 'amazing-grace', title: 'Amazing Grace', author: 'John Newton',
    text: 'Verse 1\nAmazing grace how sweet the sound\nThat saved a wretch like me\nI once was lost but now am found\nWas blind but now I see' },
  { key: 'how-great-thou-art', title: 'How Great Thou Art', author: 'Stuart K. Hine',
    text: 'Verse 1\nO Lord my God when I in awesome wonder\nConsider all the worlds Thy hands have made\n\nChorus\nThen sings my soul my Saviour God to Thee\nHow great Thou art how great Thou art\nThen sings my soul my Saviour God to Thee\nHow great Thou art how great Thou art' },
  { key: 'how-great-is-our-god', title: 'How Great Is Our God', author: 'Chris Tomlin',
    text: 'Verse 1\nThe splendor of the King clothed in majesty\nLet all the earth rejoice\n\nChorus\nHow great is our God sing with me\nHow great is our God\nAnd all will see how great how great is our God' },
  { key: 'holy-holy-holy', title: 'Holy, Holy, Holy', author: 'Reginald Heber',
    text: 'Verse 1\nHoly holy holy Lord God Almighty\nEarly in the morning our song shall rise to Thee\nHoly holy holy merciful and mighty\nGod in three persons blessed Trinity' },
  { key: 'holy-spirit', title: 'Holy Spirit', author: 'Bryan & Katie Torwalt',
    text: 'Verse 1\nThere is nothing worth more that will ever come close\nNothing can compare You are our living hope\n\nChorus\nHoly Spirit You are welcome here\nCome flood this place and fill the atmosphere' },
  { key: 'it-is-well', title: 'It Is Well With My Soul', author: 'Horatio Spafford',
    text: 'Verse 1\nWhen peace like a river attendeth my way\nWhen sorrows like sea billows roll\n\nChorus\nIt is well with my soul\nIt is well it is well with my soul' },
  { key: 'blessed-assurance', title: 'Blessed Assurance', author: 'Fanny Crosby',
    text: 'Verse 1\nBlessed assurance Jesus is mine\nOh what a foretaste of glory divine\n\nChorus\nThis is my story this is my song\nPraising my Saviour all the day long' },
  { key: 'great-is-thy-faithfulness', title: 'Great Is Thy Faithfulness', author: 'Thomas Chisholm',
    text: 'Verse 1\nGreat is Thy faithfulness O God my Father\nThere is no shadow of turning with Thee\n\nChorus\nGreat is Thy faithfulness great is Thy faithfulness\nMorning by morning new mercies I see' },
  { key: 'old-rugged-cross', title: 'The Old Rugged Cross', author: 'George Bennard',
    text: 'Verse 1\nOn a hill far away stood an old rugged cross\nThe emblem of suffering and shame\n\nChorus\nSo I will cherish the old rugged cross\nTill my trophies at last I lay down' },
  { key: 'in-christ-alone', title: 'In Christ Alone', author: 'Keith Getty & Stuart Townend',
    text: 'Verse 1\nIn Christ alone my hope is found\nHe is my light my strength my song\nThis cornerstone this solid ground\nFirm through the fiercest drought and storm' },
  { key: 'cornerstone', title: 'Cornerstone', author: 'Hillsong',
    text: 'Verse 1\nMy hope is built on nothing less\nThan Jesus blood and righteousness\n\nChorus\nChrist alone cornerstone\nWeak made strong in the Saviour love\nThrough the storm He is Lord Lord of all' },
  { key: 'oceans', title: 'Oceans (Where Feet May Fail)', author: 'Hillsong United',
    text: 'Verse 1\nYou call me out upon the waters\nThe great unknown where feet may fail\n\nChorus\nSpirit lead me where my trust is without borders\nLet me walk upon the waters wherever You would call me' },
  { key: 'what-a-beautiful-name', title: 'What a Beautiful Name', author: 'Hillsong Worship',
    text: 'Verse 1\nYou were the Word at the beginning\nOne with God the Lord Most High\n\nChorus\nWhat a beautiful name it is\nWhat a beautiful name it is\nThe name of Jesus Christ my King' },
  { key: 'reckless-love', title: 'Reckless Love', author: 'Cory Asbury',
    text: 'Verse 1\nBefore I spoke a word You were singing over me\nYou have been so so good to me\n\nChorus\nOh the overwhelming never ending reckless love of God' },
  { key: 'goodness-of-god', title: 'Goodness of God', author: 'Bethel Music',
    text: 'Verse 1\nI love You Lord for Your mercy never fails me\nAll my days I have been held in Your hands\n\nChorus\nAll my life You have been faithful\nAll my life You have been so so good\nWith every breath that I am able\nI will sing of the goodness of God' },
  { key: 'way-maker', title: 'Way Maker', author: 'Sinach',
    text: 'Verse 1\nYou are here moving in our midst\nI worship You I worship You\n\nChorus\nWay maker miracle worker promise keeper\nLight in the darkness my God that is who You are' },
  { key: 'build-my-life', title: 'Build My Life', author: 'Pat Barrett',
    text: 'Verse 1\nWorthy of every song we could ever sing\nWorthy of all the praise we could ever bring\n\nChorus\nHoly there is no one like You\nThere is none beside You\nOpen up my eyes in wonder' },
  { key: 'king-of-kings', title: 'King of Kings', author: 'Hillsong Worship',
    text: 'Verse 1\nIn the darkness we were waiting\nWithout hope without light\n\nChorus\nPraise the Father praise the Son\nPraise the Spirit three in one\nGod of glory Majesty\nPraise forever to the King of Kings' },
  { key: 'graves-into-gardens', title: 'Graves Into Gardens', author: 'Elevation Worship',
    text: 'Verse 1\nI searched the world but it could not fill me\nMan empty promises so unreliable\n\nChorus\nYou turn mourning to dancing\nYou give beauty for ashes\nYou turn shame into glory\nYou are the only one who can' },
  { key: 'o-come-to-the-altar', title: 'O Come to the Altar', author: 'Elevation Worship',
    text: 'Verse 1\nAre you hurting and broken within\nOverwhelmed by the weight of your sin\n\nChorus\nO come to the altar\nThe Father arms are open wide\nForgiveness was bought with the precious blood of Jesus Christ' },
  { key: 'living-hope', title: 'Living Hope', author: 'Phil Wickham',
    text: 'Verse 1\nHow great the chasm that lay between us\nHow high the mountain I could not climb\n\nChorus\nHallelujah praise the One who set me free\nHallelujah death has lost its grip on me' },
  { key: 'great-are-you-lord', title: 'Great Are You Lord', author: 'All Sons & Daughters',
    text: 'Verse 1\nYou give life You are love\nYou bring light to the darkness\n\nChorus\nIt is Your breath in our lungs\nSo we pour out our praise\nWe pour out our praise\nGreat are You Lord' },
  { key: 'good-good-father', title: 'Good Good Father', author: 'Chris Tomlin',
    text: 'Verse 1\nI have heard a thousand stories of what they think You are like\n\nChorus\nYou are a good good Father\nIt is who You are it is who You are\nAnd I am loved by You\nIt is who I am it is who I am' },
  { key: '10000-reasons', title: '10,000 Reasons (Bless the Lord)', author: 'Matt Redman',
    text: 'Chorus\nBless the Lord O my soul O my soul\nWorship His holy name\nSing like never before O my soul\nI will worship Your holy name' },
  { key: 'mighty-to-save', title: 'Mighty to Save', author: 'Hillsong',
    text: 'Verse 1\nEveryone needs compassion\nLove that is never failing\n\nChorus\nSaviour He can move the mountains\nMy God is mighty to save He is mighty to save' },
  { key: 'here-i-am-to-worship', title: 'Here I Am to Worship', author: 'Tim Hughes',
    text: 'Verse 1\nLight of the world You stepped down into darkness\nOpened my eyes let me see\n\nChorus\nHere I am to worship here I am to bow down\nHere I am to say that You are my God' },
  { key: 'shout-to-the-lord', title: 'Shout to the Lord', author: 'Darlene Zschech',
    text: 'Chorus\nShout to the Lord all the earth let us sing\nPower and majesty praise to the King\nMountains bow down and the seas will roar\nAt the sound of Your name' },
  { key: 'lord-i-need-you', title: 'Lord I Need You', author: 'Matt Maher',
    text: 'Verse 1\nLord I come I confess\nBowing here I find my rest\n\nChorus\nLord I need You oh I need You\nEvery hour I need You\nMy one defense my righteousness\nOh God how I need You' },
  { key: 'come-thou-fount', title: 'Come Thou Fount of Every Blessing', author: 'Robert Robinson',
    text: 'Verse 1\nCome thou fount of every blessing\nTune my heart to sing Thy grace\nStreams of mercy never ceasing\nCall for songs of loudest praise' },
  { key: 'be-thou-my-vision', title: 'Be Thou My Vision', author: 'Eleanor Hull',
    text: 'Verse 1\nBe Thou my vision O Lord of my heart\nNaught be all else to me save that Thou art\nThou my best thought by day or by night\nWaking or sleeping Thy presence my light' },
  { key: 'crown-him', title: 'Crown Him With Many Crowns', author: 'Matthew Bridges',
    text: 'Verse 1\nCrown Him with many crowns\nThe Lamb upon His throne\nHark how the heavenly anthem drowns\nAll music but its own' },
  { key: 'to-god-be-the-glory', title: 'To God Be the Glory', author: 'Fanny Crosby',
    text: 'Verse 1\nTo God be the glory great things He hath done\nSo loved He the world that He gave us His Son\n\nChorus\nPraise the Lord praise the Lord let the earth hear His voice' },
  { key: 'i-surrender-all', title: 'I Surrender All', author: 'Judson W. Van DeVenter',
    text: 'Verse 1\nAll to Jesus I surrender\nAll to Him I freely give\n\nChorus\nI surrender all I surrender all\nAll to Thee my blessed Saviour I surrender all' },
  { key: 'because-he-lives', title: 'Because He Lives', author: 'Bill & Gloria Gaither',
    text: 'Chorus\nBecause He lives I can face tomorrow\nBecause He lives all fear is gone\nBecause I know He holds the future\nAnd life is worth the living just because He lives' },
  { key: 'turn-your-eyes', title: 'Turn Your Eyes Upon Jesus', author: 'Helen H. Lemmel',
    text: 'Chorus\nTurn your eyes upon Jesus\nLook full in His wonderful face\nAnd the things of earth will grow strangely dim\nIn the light of His glory and grace' },
  { key: 'nothing-but-the-blood', title: 'Nothing but the Blood', author: 'Robert Lowry',
    text: 'Verse 1\nWhat can wash away my sin\nNothing but the blood of Jesus\nWhat can make me whole again\nNothing but the blood of Jesus' },
  { key: 'jesus-paid-it-all', title: 'Jesus Paid It All', author: 'Elvina M. Hall',
    text: 'Verse 1\nI hear the Saviour say\nThy strength indeed is small\n\nChorus\nJesus paid it all all to Him I owe\nSin had left a crimson stain He washed it white as snow' },
  { key: 'come-now-is-the-time', title: 'Come Now Is the Time to Worship', author: 'Brian Doerksen',
    text: 'Chorus\nCome now is the time to worship\nCome now is the time to give your heart\nCome just as you are to worship\nCome just as you are before your God' },
  { key: 'open-the-eyes', title: 'Open the Eyes of My Heart', author: 'Paul Baloche',
    text: 'Chorus\nOpen the eyes of my heart Lord\nOpen the eyes of my heart\nI want to see You I want to see You' },
  { key: 'above-all', title: 'Above All', author: 'Michael W. Smith',
    text: 'Chorus\nAbove all powers above all kings\nAbove all nature and all created things\nAbove all wisdom and all the ways of man\nYou were here before the world began' },
  { key: 'no-longer-slaves', title: 'No Longer Slaves', author: 'Bethel Music',
    text: 'Chorus\nI am no longer a slave to fear\nI am a child of God\nI am no longer a slave to fear\nI am a child of God' },
  { key: 'this-is-amazing-grace', title: 'This Is Amazing Grace', author: 'Phil Wickham',
    text: 'Chorus\nThis is amazing grace this is unfailing love\nThat You would take my place that You would bear my cross\nYou laid down Your life that I would be set free\nOh Jesus I sing for all that You have done for me' },
  { key: 'trading-my-sorrows', title: 'Trading My Sorrows', author: 'Darrell Evans',
    text: 'Chorus\nI am trading my sorrows I am trading my shame\nI am laying them down for the joy of the Lord\nYes Lord yes Lord yes yes Lord' },
  // Multilingual / accented targets (diacritics probe)
  { key: 'sublime-gracia', title: 'Sublime Gracia', author: 'John Newton',
    text: 'Verse 1\nSublime gracia del Señor\nQue a un infeliz salvó\nFui ciego mas hoy miro yo\nPerdido y él me halló' },
  { key: 'cuan-grande', title: 'Cuán Grande Es Él', author: 'Stuart K. Hine',
    text: 'Coro\nCuán grande es él cuán grande es él\nMi corazón entona la canción\nCuán grande es él cuán grande es él' },
  { key: 'renuevame', title: 'Renuévame', author: 'Marcos Witt',
    text: 'Coro\nRenuévame Señor Jesús\nYa no quiero ser igual\nRenuévame Señor Jesús\nPon en mí tu corazón' },
  { key: 'el-vive', title: 'Él Vive', author: 'Alfred H. Ackley',
    text: 'Coro\nÉl vive él vive\nCristo Jesús vive hoy\nÉl salva y me guarda\ny me guía con su amor' },
  { key: 'grosser-gott', title: 'Großer Gott, Wir Loben Dich', author: 'Ignaz Franz',
    text: 'Verse 1\nGroßer Gott wir loben dich\nHerr wir preisen deine Stärke\nVor dir neigt die Erde sich\nund bewundert deine Werke' },
  // --- Adversarial targets/competitors (2026-08-27 accuracy investigation) ---
  { key: 'take-my-hand', title: 'Take My Hand', author: 'Nobody Fictional',
    text: 'Verse 1\nWhen the road is long and the night is cold\nI will walk beside you still\n\nChorus\nGive me your hand and walk with me\nThrough the valley to the morning light' },
  { key: 'heart-of-worship', title: 'Heart of Worship', author: 'Matt Redman',
    text: 'Verse 1\nWhen the music fades all is stripped away\nAnd I simply come\n\nChorus\nI am coming back to the heart of worship\nAnd it is all about You all about You Jesus' },
  { key: 'son-of-god', title: 'The Son of God', author: 'Traditional',
    text: 'Verse 1\nThe Son of God goes forth to war\nA kingly crown to gain' },
  { key: 'person-of-peace', title: 'Person of Peace', author: 'Nobody Fictional',
    text: 'Verse 1\nA person of peace came near to me\nAnd showed me a better way' },
  { key: 'wellspring', title: 'Wellspring', author: 'Nobody Fictional',
    text: 'Verse 1\nWellspring of wonder fountain of life\nOverflowing in my soul' },
  { key: 'farewell-song', title: 'Farewell Song', author: 'Nobody Fictional',
    text: 'Verse 1\nSing farewell to the night\nMorning breaks and all is new' },
  { key: 'standing-firm', title: 'Standing Firm', author: 'Nobody Fictional',
    text: 'Verse 1\nStanding on the promises\nUpheld forever by his word' },
  { key: '1000-tongues', title: '1000 Tongues', author: 'Nobody Fictional',
    text: 'Verse 1\nA thousand tongues could never say\nHow good you are to me' },
];

// --- Synthetic filler: plausible worship titles from a controlled vocabulary,
// deliberately reusing leading words so FTS prefix-OR returns many hits. ---
const LEAD = ['How', 'Holy', 'Great', 'Come', 'Glorious', 'Forever', 'Jesus', 'Lord',
  'God', 'Praise', 'Worthy', 'Mighty', 'Blessed', 'Living', 'Rise', 'Shout', 'Sing',
  'Hallelujah', 'Everlasting', 'Amazing', 'Faithful', 'Wonderful', 'Glory', 'Hope'];
const MID = ['of', 'is', 'the', 'my', 'our', 'in', 'to', 'and', 'be'];
const TAIL = ['Grace', 'God', 'King', 'Love', 'Saviour', 'Redeemer', 'Light', 'Praise',
  'Glory', 'Mercy', 'Kingdom', 'Hope', 'Name', 'Song', 'Cross', 'Blood', 'Spirit',
  'Freedom', 'Wonder', 'Majesty', 'Nations', 'Heaven', 'Grace Alone', 'Faithfulness'];
const LYRIC_WORDS = [
  // content words
  'grace', 'mercy', 'love', 'holy', 'praise', 'glory', 'jesus', 'lord', 'saviour',
  'redeemer', 'mighty', 'faithful', 'forever', 'worthy', 'kingdom', 'freedom',
  'salvation', 'righteousness', 'hallelujah', 'wonderful', 'everlasting', 'shepherd',
  'heart', 'soul', 'sing', 'voice', 'raise', 'hands', 'lift', 'high', 'above',
  'heaven', 'earth', 'mountain', 'valley', 'river', 'ocean', 'fire', 'light',
  'darkness', 'morning', 'evening', 'night', 'shining', 'hope', 'joy', 'peace',
  'rest', 'breath', 'life', 'living', 'risen', 'alive', 'blood', 'cross', 'crown',
  'throne', 'king', 'father', 'spirit', 'name', 'word', 'truth', 'way', 'strong',
  'tower', 'refuge', 'shelter', 'shield', 'victory', 'power', 'honour', 'majesty',
  'wisdom', 'wonder', 'beauty', 'call', 'answer', 'seek', 'find', 'know', 'trust',
  'believe', 'follow', 'surrender', 'worship', 'bow', 'kneel', 'stand', 'walk',
  'run', 'dance', 'shout', 'whisper', 'cry', 'tears', 'blessing', 'promise',
  'anchor', 'storm', 'wind', 'waves', 'deep', 'wide', 'broken', 'healed', 'whole',
  'free', 'chains', 'door', 'gates', 'garden', 'vine', 'bread', 'water', 'fountain',
  'rain', 'desert', 'wilderness', 'home', 'again', 'always', 'never', 'every',
  'within', 'through', 'before', 'beyond',
  // stopwords — real lyric density, and the fuzz pressure the W2/W4 cases need
  'the', 'and', 'of', 'my', 'your', 'our', 'is', 'in', 'to', 'we', 'you', 'me',
  'all', 'will', 'with', 'for', 'are', 'be', 'his', 'him',
];

// Deterministic PRNG (no Math.random — keeps runs reproducible).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeFiller(n: number, seed = 12345): CorpusSong[] {
  const rnd = mulberry32(seed);
  const pick = <T,>(a: T[]): T => a[Math.floor(rnd() * a.length)];
  const out: CorpusSong[] = [];
  const seen = new Set<string>();
  let i = 0;
  const line = (): string => {
    const w: string[] = [];
    const len = 6 + Math.floor(rnd() * 4); // 6-9 words per line
    for (let k = 0; k < len; k++) w.push(pick(LYRIC_WORDS));
    return w.join(' ');
  };
  const section = (label: string): string => {
    const lines: string[] = [];
    const nLines = 4 + Math.floor(rnd() * 4); // 4-7 lines per section
    for (let l = 0; l < nLines; l++) lines.push(line());
    return `${label}\n${lines.join('\n')}`;
  };
  while (out.length < n) {
    i++;
    const parts = rnd() < 0.5
      ? [pick(LEAD), pick(MID), pick(TAIL)]
      : [pick(LEAD), pick(TAIL)];
    let title = parts.join(' ');
    // LEAD×MID×TAIL is only ~5.8k combinations; the old skip-on-duplicate loop spun
    // forever once the space was exhausted. A deterministic suffix keeps titles
    // unique (and keeps the leading-word collision pressure) at any n.
    if (seen.has(title)) title = `${title} ${out.length + 1}`;
    seen.add(title);
    const chorus = section('Chorus'); // repeated verbatim — realistic term frequency
    const text = [section('Verse 1'), chorus, section('Verse 2'), chorus, section('Verse 3'), section('Bridge')].join('\n\n');
    out.push({ key: `filler-${i}`, title, author: `Author ${i}`, text });
  }
  return out;
}

/** Full corpus: curated targets first, then n filler songs. */
export function buildCorpus(fillerCount: number): CorpusSong[] {
  return [...CURATED, ...makeFiller(fillerCount)];
}
