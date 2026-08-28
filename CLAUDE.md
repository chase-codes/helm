# Helm — house rules for agents

## Commit messages
- Keep them short and to the point, while staying clear for human readers and agents.
- Use a concise conventional-commit subject (e.g. `feat(video): …`, `docs(spec): …`); add a body only when it genuinely adds clarity.
- Do NOT add `Co-Authored-By` or `Claude-Session` trailers.

## Testing
- Gate on the mock you're about to clear, never on sibling DOM. A passive effect
  (`useEffect`) can land after the DOM commit a `findByText` resolved on, so
  `findByText(...)` → `mock.mockClear()` → `expect(mock).not.toHaveBeenCalled()`
  is a flake. Use `settleAndClear(mock, ...expectedArgs)` from `src/test/mocks.ts`
  (it awaits the call, then clears). If nothing is expected to fire at mount,
  don't clear at all — flush with `await act(async () => {})` and assert not-called.

## UX grammar
- Operator interactions follow the eight rules in `docs/ux-grammar.md` (on-air red, stable transport, click cues / double-click takes / Enter commits, undo not confirm, fixed footprints, list kit parity, empty-state invitations, theme tokens only). Read it before adding or changing any operator surface; each rule cites the code that enforces it.
