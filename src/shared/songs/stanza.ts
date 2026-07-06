// A stanza is any lyric block (verse/chorus/bridge/tag). The count equals the number of
// section rows the operator sees in the Section Rail, so it never mislabels a chorus as a
// "verse" and always matches the visible rail one-to-one.
export function stanzaLabel(count: number): string {
  return count === 1 ? '1 stanza' : `${count} stanzas`;
}
