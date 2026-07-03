import type { SongsRepo } from './songsRepo';

const HYMNS: { title: string; author: string; text: string }[] = [
  {
    title: 'Amazing Grace', author: 'John Newton',
    text: 'Verse 1\nAmazing grace! how sweet the sound,\nThat saved a wretch like me;\nI once was lost, but now am found,\nWas blind, but now I see.\n\nVerse 2\n\'Twas grace that taught my heart to fear,\nAnd grace my fears relieved;\nHow precious did that grace appear\nThe hour I first believed.\n\nVerse 3\nThrough many dangers, toils, and snares,\nI have already come;\n\'Tis grace hath brought me safe thus far,\nAnd grace will lead me home.\n\nVerse 4\nWhen we\'ve been there ten thousand years,\nBright shining as the sun,\nWe\'ve no less days to sing God\'s praise\nThan when we\'d first begun.',
  },
  {
    title: 'Only Believe', author: 'Paul Rader',
    text: 'Verse 1\nFear not, little flock, from the cross to the throne,\nFrom death into life He went for His own;\nAll power in earth, all power above,\nIs given to Him for the flock of His love.\n\nChorus\nOnly believe, only believe,\nAll things are possible, only believe;\nOnly believe, only believe,\nAll things are possible, only believe.',
  },
  {
    title: 'It Is Well With My Soul', author: 'Horatio Spafford',
    text: 'Verse 1\nWhen peace, like a river, attendeth my way,\nWhen sorrows like sea billows roll;\nWhatever my lot, Thou hast taught me to say,\nIt is well, it is well with my soul.\n\nChorus\nIt is well (it is well),\nWith my soul (with my soul),\nIt is well, it is well with my soul.',
  },
  {
    title: 'Blessed Assurance', author: 'Fanny Crosby',
    text: 'Verse 1\nBlessed assurance, Jesus is mine!\nOh, what a foretaste of glory divine!\nHeir of salvation, purchase of God,\nBorn of His Spirit, washed in His blood.\n\nChorus\nThis is my story, this is my song,\nPraising my Saviour all the day long;\nThis is my story, this is my song,\nPraising my Saviour all the day long.',
  },
  {
    title: 'Great Is Thy Faithfulness', author: 'Thomas Chisholm',
    text: 'Verse 1\nGreat is Thy faithfulness, O God my Father,\nThere is no shadow of turning with Thee;\nThou changest not, Thy compassions, they fail not;\nAs Thou hast been Thou forever wilt be.\n\nChorus\nGreat is Thy faithfulness! Great is Thy faithfulness!\nMorning by morning new mercies I see;\nAll I have needed Thy hand hath provided—\nGreat is Thy faithfulness, Lord, unto me!',
  },
  {
    title: 'Holy, Holy, Holy', author: 'Reginald Heber',
    text: 'Verse 1\nHoly, holy, holy! Lord God Almighty!\nEarly in the morning our song shall rise to Thee;\nHoly, holy, holy! merciful and mighty!\nGod in three Persons, blessed Trinity!',
  },
  {
    title: 'How Great Thou Art', author: 'Stuart K. Hine',
    text: 'Verse 1\nO Lord my God, when I in awesome wonder\nConsider all the worlds Thy hands have made,\nI see the stars, I hear the rolling thunder,\nThy power throughout the universe displayed.\n\nChorus\nThen sings my soul, my Saviour God, to Thee,\nHow great Thou art, how great Thou art!',
  },
  {
    title: 'The Old Rugged Cross', author: 'George Bennard',
    text: 'Verse 1\nOn a hill far away stood an old rugged cross,\nThe emblem of suffering and shame;\nAnd I love that old cross where the dearest and best\nFor a world of lost sinners was slain.\n\nChorus\nSo I’ll cherish the old rugged cross,\nTill my trophies at last I lay down;\nI will cling to the old rugged cross,\nAnd exchange it some day for a crown.',
  },
  {
    title: 'I\'d Rather Have Jesus', author: 'Rhea F. Miller',
    text: 'Verse 1\nI’d rather have Jesus than silver or gold,\nI’d rather be His than have riches untold;\nI’d rather have Jesus than houses or lands,\nI’d rather be led by His nail-pierced hand.',
  },
  {
    title: 'Down From His Glory', author: 'William Booth-Clibborn',
    text: 'Verse 1\nDown from His glory, ever living story,\nMy God and Saviour came,\nAnd Jesus was His name.\n\nChorus\nO how I love Him! How I adore Him!\nMy breath, my sunshine, my all in all!\nThe great Creator became my Saviour,\nAnd all God’s fullness dwelleth in Him.',
  },
];

export function seedIfEmpty(repo: SongsRepo): void {
  if (repo.count() > 0) return;
  for (const h of HYMNS) repo.add({ ...h, source: 'seed' });
}
