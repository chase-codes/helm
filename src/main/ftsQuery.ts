// FTS5 MATCH-string construction shared by the song, quote and verse searches, so the
// three repos cannot drift on quoting or the candidate cap. Tokens arrive from `norm()`
// ([a-z0-9] only) — and since the index itself stores norm()'d text (searchIndex.ts),
// vocabulary-expanded terms are equally tame; the quote escaping stays as defense.

/** Max FTS hits taken per query: keeps a common-token query's hit list under SQLite's
 * bound-variable cap for the `IN (...)` that follows — best-ranked hits survive. */
export const FTS_CANDIDATE_LIMIT = 1000;

/** One quoted FTS5 term; `prefix` appends the `*` type-ahead operator. */
export function ftsTerm(t: string, prefix: boolean): string {
  return `"${t.replace(/"/g, '""')}"${prefix ? '*' : ''}`;
}

/** The songs/quotes candidate gate: every token as a prefix, any of them (the JS scorer
 * applies the all-tokens gate afterwards). */
export function orPrefixMatch(tokens: string[]): string {
  return tokens.map((t) => ftsTerm(t, true)).join(' OR ');
}

/** The verse candidate gate: every group must match (AND); within a group, the first
 * alternative is the typed token as a prefix and the rest are exact vocabulary terms the
 * typo expansion added. */
export function andGroupsMatch(groups: string[][]): string {
  return groups
    .map((alts) => `(${alts.map((a, i) => ftsTerm(a, i === 0)).join(' OR ')})`)
    .join(' AND ');
}

/** The verse CLOSE-match gate. A verse one word short of an N-word query still holds at
 * least two of any three of its words, so the gate is the three pairs of the three most
 * selective groups (the caller picks them — longest words) rather than N clauses of N-1
 * prefix terms each: on a nine-word query that is the difference between a few
 * milliseconds and a stalled keystroke. Coarser than the rule it serves; the scorer
 * applies "all but one" to what comes back. */
export function anyTwoOfMatch(groups: string[][]): string {
  const pairs: string[] = [];
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) pairs.push(`(${andGroupsMatch([groups[i], groups[j]])})`);
  return pairs.join(' OR ');
}
