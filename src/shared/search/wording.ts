// Older-English and modern wording, folded together for VERSE search only. The operator
// types what the pastor said — "love your neighbor as yourself", "ask and you shall
// receive" — and the installed translation may say "love thy neighbour as thyself", "ask,
// and ye shall receive" (or the other way round: a KJV quote against a modern text).
// Without this the two never meet: every word must match, and "your" is not "thy".
//
// Deliberately a short closed list plus two spelling rules, not a thesaurus: only forms
// that are the SAME word in another era's spelling. Song and quote search do not use it.

/** Each row is one word in several spellings; the first is the form everything folds to. */
const CLASSES: string[][] = [
  ['your', 'thy', 'thine'],
  ['you', 'thee', 'thou', 'ye'],
  ['yourself', 'thyself'],
  ['has', 'hath'],
  ['have', 'hast'],
  ['does', 'doth', 'doeth'],
  ['do', 'dost'],
  ['did', 'didst'],
  ['can', 'canst'],
  ['shall', 'shalt'],
  ['will', 'wilt'],
  ['are', 'art'],
  ['says', 'saith'],
  ['to', 'unto'],
  ['show', 'shew'],
  ['showed', 'shewed'],
]
const FOLD = new Map<string, string>()
const MATES = new Map<string, string[]>()
for (const row of CLASSES) for (const w of row) {
  FOLD.set(w, row[0])
  MATES.set(w, row.filter((x) => x !== w))
}

// British -our words the KJV spells that way; a modern text (and an American typing) says
// -or. A list, not a rule: folding "our" → "or" everywhere would merge mourning into morning.
const OUR = [
  'neighbour', 'saviour', 'honour', 'dishonour', 'labour', 'favour', 'colour', 'armour', 'valour',
  'vapour', 'odour', 'savour', 'harbour', 'rumour', 'behaviour', 'succour', 'clamour', 'rigour', 'endeavour',
]
const OR = OUR.map((w) => w.slice(0, -3) + 'or')

// Nouns that merely end in -eth; everything else that long is a third-person verb
// ("loveth", "cometh", "strengtheneth"). Ordinals (-ieth) are excluded by the rule itself.
const NOT_A_VERB = new Set(['teeth', 'nazareth', 'elisabeth', 'japheth', 'shibboleth', 'gilgaleth'])
const isEthVerb = (w: string): boolean => w.length >= 5 && w.endsWith('eth') && !w.endsWith('ieth') && !NOT_A_VERB.has(w)

/** One word (already `norm()`'d) in its modern spelling. Applied to query words and verse
 * words alike before scoring, so either wording finds the other and neither is favoured.
 * "-eth" verbs fold to "-es" ("loveth" → "loves", "doeth" → "does"); where that is not quite
 * the modern form ("strengtheneth" → "strengthenes") the scorer's stem tier closes the gap. */
export function modernWord(w: string): string {
  const fixed = FOLD.get(w)
  if (fixed) return fixed
  for (const stem of OUR) if (w.startsWith(stem)) return stem.slice(0, -3) + 'or' + w.slice(stem.length)
  if (isEthVerb(w)) return w.slice(0, -3) + 'es'
  return w
}

/** The other spellings a typed word may have in the indexed text — exact index terms to
 * OR into the candidate gate beside the word itself. Guesses that are not real words cost
 * nothing: a term the index does not hold matches no verse. */
export function wordingVariants(t: string): string[] {
  const out = new Set<string>(MATES.get(t) ?? [])
  OR.forEach((stem, i) => {
    if (t.startsWith(stem)) out.add(OUR[i] + t.slice(stem.length))
  })
  OUR.forEach((stem, i) => {
    if (t.startsWith(stem)) out.add(OR[i] + t.slice(stem.length))
  })
  if (t.length >= 4 && t.endsWith('s') && !t.endsWith('ss')) {
    out.add(t.replace(/e?s$/, '') + 'eth') // loves → loveth, strengthens → strengtheneth
    out.add(t.slice(0, -1) + 'th') // comes → cometh
  }
  if (isEthVerb(t)) {
    out.add(t.slice(0, -3) + 's') // walketh → walks
    out.add(t.slice(0, -3) + 'es') // goeth → goes
    out.add(t.slice(0, -2) + 's') // loveth → loves
  }
  out.delete(t)
  return [...out]
}
