# Shared Interaction Primitives Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build two reusable renderer primitives — a right-click context menu and a selectable-list-row + Delete-key pattern — and prove each by wiring one real consumer (Songs "Edit", schedule delete).

**Architecture:** Two self-contained primitives in `src/renderer/operator/`. The context menu is a hook (`useContextMenu`) that owns state + renders a `ContextMenu` component consuming `ThemeCtx`; it dismisses on Escape/outside-click/scroll and `stopPropagation`s the keys it handles so App's global `document` keydown delegate doesn't also fire. The selectable-row pattern is a tiny `useListSelection` hook plus a new optional `onDelete` on the existing `ModeKeyHandler`; App's keydown logic is extracted into a pure, testable `dispatchModeKey`. Schedule delete needs a net-new `schedule:remove` IPC end-to-end.

**Tech Stack:** TypeScript, React (inline styles + `ThemeCtx`), Electron IPC (`contextBridge`/`ipcRenderer`), better-sqlite3, Vitest + @testing-library/react (jsdom).

## Global Constraints

- Commit messages: concise conventional-commit subjects (e.g. `feat(ui):`, `feat(songs):`, `feat(sermon):`, `feat(ipc):`). NO `Co-Authored-By` / `Claude-Session` trailers (CLAUDE.md).
- Keyboard-first, live mid-service: nothing mouse-only for the delete *action* (Delete key AND right-click both work); Escape always backs out; the menu must not trap focus past its own close.
- Match renderer idioms: inline styles + `ThemeCtx`, existing rail/panel components, `*.test.tsx`/`*.test.ts` style.
- Accessibility: ARIA menu roles (`role="menu"`/`menuitem`), fully keyboard operable.
- Test runner: `npm test` runs `vitest run --passWithNoTests`. Single file: `npx vitest run <path>`. Typecheck: `npm run typecheck`.
- Vitest config has NO `globals: true`; renderer tests must `import { afterEach } from 'vitest'` and call `afterEach(cleanup)` explicitly, and start jsdom files with `// @vitest-environment jsdom`.

---

## File structure

**Primitive A — context menu (new):**
- `src/renderer/operator/ContextMenu.tsx` — presentational menu + behavior (positioning, keyboard, a11y, dismiss).
- `src/renderer/operator/useContextMenu.tsx` — hook: `{ open, close, menu }`.
- `src/renderer/operator/ContextMenu.test.tsx` — primitive tests.

**Primitive B — selectable rows + Delete (new + modify):**
- `src/renderer/operator/useListSelection.ts` — `{ selectedId, select, clear, isSelected }`.
- `src/renderer/operator/useListSelection.test.tsx` — hook test.
- `src/renderer/operator/keyDispatch.ts` — pure `dispatchModeKey` extracted from App.
- `src/renderer/operator/keyDispatch.test.ts` — branch-table tests (incl. Delete/Backspace).
- `src/renderer/operator/App.tsx` — add `onDelete?` to `ModeKeyHandler`; call `dispatchModeKey`.

**Net-new IPC — schedule remove (modify):**
- `src/main/scheduleRepo.ts`, `src/main/scheduleRepo.test.ts`, `src/shared/types.ts`, `src/main/ipc.ts`, `src/preload/index.ts`.

**Consumers (modify + new tests):**
- `src/renderer/operator/SongSearchRail.tsx` (+ `SongSearchRail.test.tsx`), `src/renderer/operator/SongsMode.tsx`.
- `src/renderer/operator/SchedulePanel.tsx` (+ `SchedulePanel.test.tsx`), `src/renderer/operator/SermonMode.tsx`.

---

## Task 1: Schedule remove IPC (end-to-end)

**Files:**
- Modify: `src/main/scheduleRepo.ts`
- Modify: `src/main/scheduleRepo.test.ts`
- Modify: `src/shared/types.ts:82` (CH) and `:181-184` (HelmApi.schedule)
- Modify: `src/main/ipc.ts:66-67`
- Modify: `src/preload/index.ts:38-41`

**Interfaces:**
- Produces: `scheduleRepo.remove(id: string): ScriptureReading[]`; `CH.scheduleRemove = 'schedule:remove'`; `window.helm.schedule.remove(id: string): Promise<ScriptureReading[]>`.

- [ ] **Step 1: Write the failing repo test**

Add to `src/main/scheduleRepo.test.ts`:

```ts
test('remove deletes by id and returns the updated list', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  const two = repo.add({ book: 'John', ch: 3, from: 16, to: 16 })
  const target = two.find((r) => r.book === 'John')!
  const after = repo.remove(target.id)
  expect(after).toHaveLength(1)
  expect(after[0].book).toBe('Genesis')
})

test('remove of an unknown id is a no-op returning the current list', () => {
  repo.add({ book: 'Genesis', ch: 1, from: 1, to: 2 })
  const after = repo.remove('does-not-exist')
  expect(after).toHaveLength(1)
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/main/scheduleRepo.test.ts`
Expected: FAIL — `repo.remove is not a function` (and TS error on the interface).

- [ ] **Step 3: Implement `remove` in the repo**

In `src/main/scheduleRepo.ts`, add to the `ScheduleRepo` interface (after `add`):

```ts
  remove(id: string): ScriptureReading[]
```

Add a prepared statement next to the others (after the `maxPosition` prepare, ~line 38):

```ts
  const deleteItem = db.prepare('DELETE FROM service_items WHERE id = ?')
```

Add the method to the returned object (after the `add` method, before the closing `}`):

```ts
    remove(id) {
      deleteItem.run(id)
      return list()
    }
```

- [ ] **Step 4: Run the repo test to verify it passes**

Run: `npx vitest run src/main/scheduleRepo.test.ts`
Expected: PASS (all schedule repo tests).

- [ ] **Step 5: Add the channel + typed API surface**

In `src/shared/types.ts` line 82, extend the CH entry:

```ts
  scheduleList: 'schedule:list', scheduleAdd: 'schedule:add', scheduleRemove: 'schedule:remove',
```

In `src/shared/types.ts` HelmApi (lines 181-184), add `remove` to the schedule block:

```ts
  schedule: {
    list(): Promise<ScriptureReading[]>;
    add(r: Omit<ScriptureReading, 'id'>): Promise<ScriptureReading[]>;
    remove(id: string): Promise<ScriptureReading[]>;
  };
```

In `src/main/ipc.ts`, after line 67 (`CH.scheduleAdd` handler):

```ts
  ipcMain.handle(CH.scheduleRemove, (_e, id: string) => scheduleRepo.remove(id));
```

In `src/preload/index.ts`, in the `schedule` block (lines 38-41):

```ts
  schedule: {
    list: () => ipcRenderer.invoke(CH.scheduleList),
    add: (r) => ipcRenderer.invoke(CH.scheduleAdd, r),
    remove: (id) => ipcRenderer.invoke(CH.scheduleRemove, id),
  },
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS, no type errors.

- [ ] **Step 7: Commit**

```bash
git add src/main/scheduleRepo.ts src/main/scheduleRepo.test.ts src/shared/types.ts src/main/ipc.ts src/preload/index.ts
git commit -m "feat(ipc): add schedule:remove end-to-end"
```

---

## Task 2: Context-menu primitive

**Files:**
- Create: `src/renderer/operator/ContextMenu.tsx`
- Create: `src/renderer/operator/useContextMenu.tsx`
- Create: `src/renderer/operator/ContextMenu.test.tsx`

**Interfaces:**
- Produces:
  - `ContextMenuItem = { label: string; onSelect: () => void; danger?: boolean; disabled?: boolean }`
  - `ContextMenu` component: props `{ open: boolean; x: number; y: number; items: ContextMenuItem[]; onClose: () => void; restoreFocusTo?: HTMLElement | null }`
  - `useContextMenu(): { open: (e: React.MouseEvent, items: ContextMenuItem[]) => void; close: () => void; menu: JSX.Element }`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/operator/ContextMenu.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ContextMenu, type ContextMenuItem } from './ContextMenu'
import { ThemeCtx } from './ThemeCtx'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

function renderMenu(items: ContextMenuItem[], onClose = vi.fn()) {
  render(
    <ThemeCtx.Provider value={themeFor('dark')}>
      <ContextMenu open x={100} y={120} items={items} onClose={onClose} />
    </ThemeCtx.Provider>
  )
  return { onClose }
}

describe('ContextMenu', () => {
  it('renders nothing when closed', () => {
    render(
      <ThemeCtx.Provider value={themeFor('dark')}>
        <ContextMenu open={false} x={0} y={0} items={[{ label: 'Edit', onSelect: vi.fn() }]} onClose={vi.fn()} />
      </ThemeCtx.Provider>
    )
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('renders items with menu/menuitem roles at the given position', () => {
    renderMenu([{ label: 'Edit', onSelect: vi.fn() }])
    const menu = screen.getByRole('menu')
    expect(menu.style.left).toBe('100px')
    expect(menu.style.top).toBe('120px')
    expect(screen.getByRole('menuitem', { name: 'Edit' })).toBeTruthy()
  })

  it('activates an item on click and closes', () => {
    const onSelect = vi.fn()
    const { onClose } = renderMenu([{ label: 'Edit', onSelect }])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onSelect).toHaveBeenCalledTimes(1)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('does not activate a disabled item', () => {
    const onSelect = vi.fn()
    renderMenu([{ label: 'Edit', onSelect, disabled: true }])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Edit' }))
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('closes on Escape', () => {
    const { onClose } = renderMenu([{ label: 'Edit', onSelect: vi.fn() }])
    fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('closes on outside (scrim) click', () => {
    const onClose = vi.fn()
    const { container } = render(
      <ThemeCtx.Provider value={themeFor('dark')}>
        <ContextMenu open x={10} y={10} items={[{ label: 'Edit', onSelect: vi.fn() }]} onClose={onClose} />
      </ThemeCtx.Provider>
    )
    // The scrim is the first fixed full-viewport div (inset:0).
    const scrim = container.querySelector('div[style*="inset"]') as HTMLElement
    fireEvent.click(scrim)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('ArrowDown moves the active item so Enter fires the next one', () => {
    const first = vi.fn()
    const second = vi.fn()
    renderMenu([
      { label: 'First', onSelect: first },
      { label: 'Second', onSelect: second }
    ])
    const menu = screen.getByRole('menu')
    fireEvent.keyDown(menu, { key: 'ArrowDown' })
    fireEvent.keyDown(menu, { key: 'Enter' })
    expect(second).toHaveBeenCalledTimes(1)
    expect(first).not.toHaveBeenCalled()
  })

  it('marks danger items via data-danger', () => {
    renderMenu([{ label: 'Delete', onSelect: vi.fn(), danger: true }])
    expect(screen.getByRole('menuitem', { name: 'Delete' }).getAttribute('data-danger')).toBe('true')
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/operator/ContextMenu.test.tsx`
Expected: FAIL — cannot find module `./ContextMenu`.

- [ ] **Step 3: Implement `ContextMenu.tsx`**

Create `src/renderer/operator/ContextMenu.tsx`:

```tsx
import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { ThemeCtx } from './ThemeCtx';

export interface ContextMenuItem {
  label: string;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  /** Element to restore focus to when the menu closes (the right-click trigger). */
  restoreFocusTo?: HTMLElement | null;
}

/**
 * Cursor-positioned right-click menu. Renders null while closed. While open it focuses
 * itself and `stopPropagation`s the keys it handles, so App.tsx's global document keydown
 * delegate does NOT also step cues / go live / close settings — the menu owns the keyboard
 * only while visible, then hands control straight back on close (see the interaction-
 * primitives design, "fit, don't fight"). Theme comes from ThemeCtx (no theme prop) since
 * it is invoked from many call sites.
 */
export function ContextMenu({ open, x, y, items, onClose, restoreFocusTo }: ContextMenuProps): JSX.Element | null {
  const T = useContext(ThemeCtx);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState(0);
  const [pos, setPos] = useState({ x, y });

  const firstEnabled = items.findIndex((it) => !it.disabled);

  // Reset highlight to the first enabled item whenever the menu (re)opens.
  useEffect(() => {
    if (open) setActive(firstEnabled === -1 ? 0 : firstEnabled);
  }, [open, firstEnabled]);

  // Clamp to the viewport once measured, flipping left/up when it would overflow.
  useLayoutEffect(() => {
    if (!open) return;
    const el = menuRef.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 6;
    let nx = x;
    let ny = y;
    if (x + width + pad > window.innerWidth) nx = Math.max(pad, window.innerWidth - width - pad);
    if (y + height + pad > window.innerHeight) ny = Math.max(pad, window.innerHeight - height - pad);
    setPos({ x: nx, y: ny });
  }, [open, x, y, items]);

  // Move DOM focus into the menu on open; restore to the trigger on close.
  useEffect(() => {
    if (!open) return;
    menuRef.current?.focus();
    return () => {
      restoreFocusTo?.focus?.();
    };
  }, [open, restoreFocusTo]);

  // Any scroll / resize / window blur dismisses the menu (its anchor point is now stale).
  useEffect(() => {
    if (!open) return;
    const dismiss = (): void => onClose();
    window.addEventListener('scroll', dismiss, true);
    window.addEventListener('resize', dismiss);
    window.addEventListener('blur', dismiss);
    return () => {
      window.removeEventListener('scroll', dismiss, true);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('blur', dismiss);
    };
  }, [open, onClose]);

  if (!open) return null;

  const activate = (it: ContextMenuItem): void => {
    if (it.disabled) return;
    onClose();
    it.onSelect();
  };

  const step = (dir: 1 | -1): void => {
    setActive((cur) => {
      const n = items.length;
      let i = cur;
      for (let k = 0; k < n; k++) {
        i = (i + dir + n) % n;
        if (!items[i].disabled) return i;
      }
      return cur;
    });
  };

  const onKeyDown = (e: ReactKeyboardEvent): void => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      e.stopPropagation();
      step(1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      e.stopPropagation();
      step(-1);
    } else if (e.key === 'Home') {
      e.preventDefault();
      e.stopPropagation();
      setActive(firstEnabled === -1 ? 0 : firstEnabled);
    } else if (e.key === 'End') {
      e.preventDefault();
      e.stopPropagation();
      for (let i = items.length - 1; i >= 0; i--) {
        if (!items[i].disabled) {
          setActive(i);
          break;
        }
      }
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      e.stopPropagation();
      const it = items[active];
      if (it) activate(it);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
    }
  };

  const scrimStyle: CSSProperties = { position: 'fixed', inset: 0, zIndex: 60 };
  const menuStyle: CSSProperties = {
    position: 'fixed',
    top: `${pos.y}px`,
    left: `${pos.x}px`,
    zIndex: 61,
    minWidth: '168px',
    background: T.panel3,
    borderRadius: '10px',
    padding: '5px',
    boxShadow: `0 18px 50px rgba(0,0,0,.45), inset 0 0 0 1px ${T.border}`,
    outline: 'none'
  };
  const itemStyle = (it: ContextMenuItem, i: number): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    width: '100%',
    textAlign: 'left',
    padding: '8px 10px',
    borderRadius: '7px',
    fontSize: '13px',
    fontWeight: 500,
    cursor: it.disabled ? 'default' : 'pointer',
    opacity: it.disabled ? 0.4 : 1,
    color: it.danger ? T.live : T.text,
    background: i === active && !it.disabled ? (it.danger ? `${T.live}1c` : T.panel2) : 'transparent'
  });

  return (
    <>
      <div
        style={scrimStyle}
        onClick={onClose}
        onContextMenu={(e) => {
          e.preventDefault();
          onClose();
        }}
      />
      <div ref={menuRef} role="menu" tabIndex={-1} style={menuStyle} onKeyDown={onKeyDown}>
        {items.map((it, i) => (
          <button
            key={i}
            role="menuitem"
            aria-disabled={it.disabled || undefined}
            data-danger={it.danger || undefined}
            tabIndex={-1}
            style={itemStyle(it, i)}
            onMouseEnter={() => !it.disabled && setActive(i)}
            onClick={() => activate(it)}
          >
            {it.label}
          </button>
        ))}
      </div>
    </>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/operator/ContextMenu.test.tsx`
Expected: PASS (all cases).

- [ ] **Step 5: Implement `useContextMenu.tsx`**

Create `src/renderer/operator/useContextMenu.tsx`:

```tsx
import { useCallback, useState, type JSX, type MouseEvent as ReactMouseEvent } from 'react';
import { ContextMenu, type ContextMenuItem } from './ContextMenu';

interface MenuState {
  open: boolean;
  x: number;
  y: number;
  items: ContextMenuItem[];
  trigger: HTMLElement | null;
}

const CLOSED: MenuState = { open: false, x: 0, y: 0, items: [], trigger: null };

export interface UseContextMenu {
  /** Wire to `onContextMenu`; preventDefaults, anchors at the cursor, remembers the trigger. */
  open: (e: ReactMouseEvent, items: ContextMenuItem[]) => void;
  close: () => void;
  /** Drop into JSX once; renders null while closed. */
  menu: JSX.Element;
}

/**
 * Owns context-menu state and rendering so a consumer wires it in ~3 lines:
 *   const { open, menu } = useContextMenu();
 *   <Row onContextMenu={(e) => open(e, [{ label: 'Edit', onSelect }])} /> ... {menu}
 */
export function useContextMenu(): UseContextMenu {
  const [state, setState] = useState<MenuState>(CLOSED);
  const open = useCallback((e: ReactMouseEvent, items: ContextMenuItem[]): void => {
    e.preventDefault();
    setState({ open: true, x: e.clientX, y: e.clientY, items, trigger: e.currentTarget as HTMLElement });
  }, []);
  const close = useCallback((): void => setState((s) => ({ ...CLOSED, trigger: s.trigger })), []);
  const menu = (
    <ContextMenu open={state.open} x={state.x} y={state.y} items={state.items} onClose={close} restoreFocusTo={state.trigger} />
  );
  return { open, close, menu };
}
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/ContextMenu.tsx src/renderer/operator/useContextMenu.tsx src/renderer/operator/ContextMenu.test.tsx
git commit -m "feat(ui): reusable context-menu primitive"
```

---

## Task 3: Delete-key dispatch (`dispatchModeKey` + `ModeKeyHandler.onDelete`)

**Files:**
- Create: `src/renderer/operator/keyDispatch.ts`
- Create: `src/renderer/operator/keyDispatch.test.ts`
- Modify: `src/renderer/operator/App.tsx:19-33` (interface) and `:57-97` (effect)

**Interfaces:**
- Consumes: `ModeKeyHandler` from `./App`.
- Produces:
  - `ModeKeyHandler.onDelete?: () => void` (new optional field).
  - `KeyDispatchCtx = { settingsOpen: boolean; closeSettings: () => void; handler: ModeKeyHandler | null }`
  - `dispatchModeKey(e: KeyboardEvent, ctx: KeyDispatchCtx): void`

- [ ] **Step 1: Write the failing tests**

Create `src/renderer/operator/keyDispatch.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest'
import { dispatchModeKey } from './keyDispatch'
import type { ModeKeyHandler } from './App'

function makeHandler(over: Partial<ModeKeyHandler> = {}): ModeKeyHandler {
  return {
    onEscape: vi.fn(() => false),
    onArrow: vi.fn(),
    onGoLive: vi.fn(),
    isModalOpen: vi.fn(() => false),
    ...over
  }
}

function ev(key: string, tag = 'body'): KeyboardEvent {
  return { key, target: { tagName: tag.toUpperCase() }, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

const baseCtx = () => ({ settingsOpen: false, closeSettings: vi.fn() })

describe('dispatchModeKey', () => {
  it('Delete dispatches onDelete when the mode provides one', () => {
    const onDelete = vi.fn()
    const e = ev('Delete')
    dispatchModeKey(e, { ...baseCtx(), handler: makeHandler({ onDelete }) })
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('Backspace also dispatches onDelete', () => {
    const onDelete = vi.fn()
    dispatchModeKey(ev('Backspace'), { ...baseCtx(), handler: makeHandler({ onDelete }) })
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('Delete while typing in an input is ignored', () => {
    const onDelete = vi.fn()
    dispatchModeKey(ev('Delete', 'input'), { ...baseCtx(), handler: makeHandler({ onDelete }) })
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('Delete is a no-op (no preventDefault) when the mode has no onDelete', () => {
    const e = ev('Delete')
    dispatchModeKey(e, { ...baseCtx(), handler: makeHandler() })
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('arrows still step the cue (regression guard on the extraction)', () => {
    const onArrow = vi.fn()
    dispatchModeKey(ev('ArrowRight'), { ...baseCtx(), handler: makeHandler({ onArrow }) })
    expect(onArrow).toHaveBeenCalledWith(1)
  })

  it('Escape closes settings first when open', () => {
    const closeSettings = vi.fn()
    const onEscape = vi.fn(() => false)
    dispatchModeKey(ev('Escape'), { settingsOpen: true, closeSettings, handler: makeHandler({ onEscape }) })
    expect(closeSettings).toHaveBeenCalledTimes(1)
    expect(onEscape).not.toHaveBeenCalled()
  })

  it('Enter goLive is suppressed while a modal is open', () => {
    const onGoLive = vi.fn()
    dispatchModeKey(ev('Enter'), { ...baseCtx(), handler: makeHandler({ onGoLive, isModalOpen: () => true }) })
    expect(onGoLive).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/renderer/operator/keyDispatch.test.ts`
Expected: FAIL — cannot find module `./keyDispatch`.

- [ ] **Step 3: Add `onDelete` to `ModeKeyHandler`**

In `src/renderer/operator/App.tsx`, inside the `ModeKeyHandler` interface (after `isModalOpen: () => boolean;`, before the closing brace at line 33), add:

```ts
  /**
   * Delete/Backspace (only while not typing): remove the mode's currently selected list
   * row, if any. Optional — modes with no selectable list omit it, and App then leaves
   * Delete/Backspace untouched. See useListSelection + the interaction-primitives design.
   */
  onDelete?: () => void;
```

- [ ] **Step 4: Implement `keyDispatch.ts` (faithful extraction of App's handler + Delete branch)**

Create `src/renderer/operator/keyDispatch.ts`:

```ts
import type { ModeKeyHandler } from './App';

export interface KeyDispatchCtx {
  settingsOpen: boolean;
  closeSettings: () => void;
  handler: ModeKeyHandler | null;
}

/**
 * Pure translation of a document keydown into the active mode's delegate action.
 * Extracted verbatim from App's inline handler (so the branch table stays unit-testable
 * without mounting the whole app) plus the new Delete/Backspace branch. App wires this to
 * `document` and passes fresh context each event.
 *
 * Escape fires even while typing (closes any open modal); settings sits above the mode
 * layer so an open settings modal closes first. Everything else is gated behind the typing
 * guard so editing an input/textarea is never hijacked.
 */
export function dispatchModeKey(e: KeyboardEvent, ctx: KeyDispatchCtx): void {
  const target = e.target as HTMLElement | null;
  const tag = target?.tagName?.toLowerCase();
  const typing = tag === 'input' || tag === 'textarea';
  const { handler } = ctx;

  if (e.key === 'Escape') {
    if (ctx.settingsOpen) {
      ctx.closeSettings();
      return;
    }
    handler?.onEscape();
    return;
  }
  if (typing) return;

  if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
    e.preventDefault();
    handler?.onArrow(1);
  } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
    e.preventDefault();
    handler?.onArrow(-1);
  } else if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    // Guard Enter/Space→goLive behind an open modal (quick-add or settings).
    if (ctx.settingsOpen || handler?.isModalOpen()) return;
    handler?.onGoLive();
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    // Only act when the active mode offers a delete; otherwise leave the key alone
    // (Backspace is the primary "delete" key on Mac keyboards, so both map here).
    if (!handler?.onDelete) return;
    e.preventDefault();
    handler.onDelete();
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/renderer/operator/keyDispatch.test.ts`
Expected: PASS.

- [ ] **Step 6: Wire App to `dispatchModeKey`**

In `src/renderer/operator/App.tsx`, add the import near the top (with the other local imports, after the `blurOnPointerClick` import at line 3):

```ts
import { dispatchModeKey } from './keyDispatch';
```

Replace the entire keydown effect (lines 57-97, the `useEffect` whose body defines `onKeyDown` and adds/removes the `keydown` listener) with:

```ts
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void =>
      dispatchModeKey(e, {
        settingsOpen,
        closeSettings: () => setSettingsOpen(false),
        handler: keyHandlerRef.current
      });
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [settingsOpen]);
```

- [ ] **Step 7: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS (extraction is behavior-preserving; keyDispatch tests cover the branches).

- [ ] **Step 8: Commit**

```bash
git add src/renderer/operator/keyDispatch.ts src/renderer/operator/keyDispatch.test.ts src/renderer/operator/App.tsx
git commit -m "feat(ui): extract mode key dispatch and add Delete handling"
```

---

## Task 4: `useListSelection` hook

**Files:**
- Create: `src/renderer/operator/useListSelection.ts`
- Create: `src/renderer/operator/useListSelection.test.tsx`

**Interfaces:**
- Produces: `useListSelection(): { selectedId: string | null; select: (id: string) => void; clear: () => void; isSelected: (id: string) => boolean }`

- [ ] **Step 1: Write the failing test**

Create `src/renderer/operator/useListSelection.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useListSelection } from './useListSelection'

afterEach(cleanup)

// Tiny host component so we exercise the hook through real React state transitions.
function Host() {
  const sel = useListSelection()
  return (
    <div>
      <span data-testid="selected">{sel.selectedId ?? 'none'}</span>
      <span data-testid="a-selected">{String(sel.isSelected('a'))}</span>
      <button onClick={() => sel.select('a')}>select-a</button>
      <button onClick={() => sel.select('b')}>select-b</button>
      <button onClick={() => sel.clear()}>clear</button>
    </div>
  )
}

describe('useListSelection', () => {
  it('selects, re-selects, and clears', () => {
    render(<Host />)
    expect(screen.getByTestId('selected').textContent).toBe('none')
    expect(screen.getByTestId('a-selected').textContent).toBe('false')

    fireEvent.click(screen.getByText('select-a'))
    expect(screen.getByTestId('selected').textContent).toBe('a')
    expect(screen.getByTestId('a-selected').textContent).toBe('true')

    fireEvent.click(screen.getByText('select-b'))
    expect(screen.getByTestId('selected').textContent).toBe('b')
    expect(screen.getByTestId('a-selected').textContent).toBe('false')

    fireEvent.click(screen.getByText('clear'))
    expect(screen.getByTestId('selected').textContent).toBe('none')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/operator/useListSelection.test.tsx`
Expected: FAIL — cannot find module `./useListSelection`.

- [ ] **Step 3: Implement `useListSelection.ts`**

Create `src/renderer/operator/useListSelection.ts`:

```ts
import { useCallback, useState } from 'react';

export interface ListSelection {
  /** The id of the currently selected row, or null. */
  selectedId: string | null;
  select: (id: string) => void;
  clear: () => void;
  isSelected: (id: string) => boolean;
}

/**
 * Shared "one selected row" state for a list. The reusable pattern is: this hook for
 * selection + `ModeKeyHandler.onDelete` for the keyboard action + the context-menu
 * primitive for right-click — reused wherever a schedule/list appears.
 */
export function useListSelection(): ListSelection {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const select = useCallback((id: string): void => setSelectedId(id), []);
  const clear = useCallback((): void => setSelectedId(null), []);
  const isSelected = useCallback((id: string): boolean => id === selectedId, [selectedId]);
  return { selectedId, select, clear, isSelected };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/renderer/operator/useListSelection.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/operator/useListSelection.ts src/renderer/operator/useListSelection.test.tsx
git commit -m "feat(ui): add useListSelection hook"
```

---

## Task 5: Consumer #1 — Songs right-click → "Edit"

**Files:**
- Modify: `src/renderer/operator/SongSearchRail.tsx` (props + row `onContextMenu`)
- Create: `src/renderer/operator/SongSearchRail.test.tsx`
- Modify: `src/renderer/operator/SongsMode.tsx` (wire `useContextMenu` + stub `Edit`)

**Interfaces:**
- Consumes: `useContextMenu` (Task 2).
- Produces: `SongSearchRailProps.onRowContextMenu?: (id: string, e: React.MouseEvent) => void`.

- [ ] **Step 1: Write the failing rail test**

Create `src/renderer/operator/SongSearchRail.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SongSearchRail, type SongRow } from './SongSearchRail'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

const rows: SongRow[] = [
  { id: 's1', title: 'Amazing Grace', author: 'Newton', snippet: '', hasSnippet: false, isActive: false }
]

const baseProps = {
  theme: themeFor('dark'),
  dark: true,
  width: 250,
  q: '',
  setQ: vi.fn(),
  field: 'all' as const,
  setField: vi.fn(),
  rows,
  noResults: false,
  emptyText: '',
  onKeyDown: vi.fn(),
  onSelect: vi.fn(),
  onAddSong: vi.fn()
}

describe('SongSearchRail', () => {
  it('fires onRowContextMenu with the row id on right-click', () => {
    const onRowContextMenu = vi.fn()
    render(<SongSearchRail {...baseProps} onRowContextMenu={onRowContextMenu} />)
    const row = screen.getByText('Amazing Grace').closest('button') as HTMLButtonElement
    fireEvent.contextMenu(row)
    expect(onRowContextMenu).toHaveBeenCalledTimes(1)
    expect(onRowContextMenu.mock.calls[0][0]).toBe('s1')
  })

  it('left-click still selects (unchanged)', () => {
    const onSelect = vi.fn()
    render(<SongSearchRail {...baseProps} onSelect={onSelect} />)
    fireEvent.click(screen.getByText('Amazing Grace').closest('button') as HTMLButtonElement)
    expect(onSelect).toHaveBeenCalledWith('s1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/operator/SongSearchRail.test.tsx`
Expected: FAIL — `onRowContextMenu` not applied (right-click does nothing).

- [ ] **Step 3: Add the prop + wire both row lists**

In `src/renderer/operator/SongSearchRail.tsx`:

Change the React type import (line 1) to include `MouseEvent`:

```ts
import type { CSSProperties, JSX, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
```

Add to `SongSearchRailProps` (after `onAddSong: () => void;`):

```ts
  onRowContextMenu?: (id: string, e: ReactMouseEvent) => void;
```

Add `onRowContextMenu` to the destructured params (after `onAddSong`).

On the primary row button (line 165, `<button key={r.id} style={rowStyle(r.isActive)} onClick={() => onSelect(r.id)}>`), add the handler:

```tsx
          <button
            key={r.id}
            style={rowStyle(r.isActive)}
            onClick={() => onSelect(r.id)}
            onContextMenu={(e) => onRowContextMenu?.(r.id, e)}
          >
```

On the secondary ("Also in lyrics") row button (line 194, same shape), add the same `onContextMenu={(e) => onRowContextMenu?.(r.id, e)}`.

- [ ] **Step 4: Run the rail test to verify it passes**

Run: `npx vitest run src/renderer/operator/SongSearchRail.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire the menu into `SongsMode`**

In `src/renderer/operator/SongsMode.tsx`:

Add imports (after the `QuickAdd` import at line 11):

```ts
import { useContextMenu } from './useContextMenu';
```

Inside `SongsMode`, after the `usePresentationState()` line (line 56), add:

```ts
  const contextMenu = useContextMenu();
```

Add the stub edit handler next to `selectSong` (after `selectSong`, ~line 139):

```ts
  // Stub for the Songs quick-edit follow-up. The context menu is the deliverable here;
  // this just proves the wiring by surfacing the intent and selecting the row. Replace
  // with the real in-preview quick-edit when that feature lands.
  const onEditSong = (id: string): void => {
    selectSong(id);
    console.info('[songs] quick-edit requested for', id);
  };
```

Pass the handler to the rail (in the `<SongSearchRail ... />` JSX, after `onAddSong=...`):

```tsx
        onRowContextMenu={(id, e) =>
          contextMenu.open(e, [{ label: 'Edit', onSelect: () => onEditSong(id) }])
        }
```

Render the menu — add `{contextMenu.menu}` just before the `{quickAddOpen && ...}` line near the end of the returned tree (line 468):

```tsx
      {contextMenu.menu}
      {quickAddOpen && <QuickAdd open={quickAddOpen} onClose={() => setQuickAddOpen(false)} onSaved={onQuickAddSaved} />}
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/SongSearchRail.tsx src/renderer/operator/SongSearchRail.test.tsx src/renderer/operator/SongsMode.tsx
git commit -m "feat(songs): right-click Edit on song rows via context menu"
```

---

## Task 6: Consumer #2 — schedule select + delete + undo

**Files:**
- Modify: `src/renderer/operator/SchedulePanel.tsx` (`ScheduleRow` fields, row `onContextMenu`, selection style, undo toast)
- Create: `src/renderer/operator/SchedulePanel.test.tsx`
- Modify: `src/renderer/operator/SermonMode.tsx` (selection, `removeReading`, undo, `onDelete`, right-click menu, render `{menu}`)

**Interfaces:**
- Consumes: `useContextMenu` (Task 2), `useListSelection` (Task 4), `ModeKeyHandler.onDelete` (Task 3), `window.helm.schedule.remove` (Task 1).
- Produces:
  - `ScheduleRow` gains `isSelected: boolean` and `onContextMenu: (e: React.MouseEvent) => void`.
  - `SchedulePanelProps` gains `undo?: { label: string; onUndo: () => void }`.

- [ ] **Step 1: Write the failing panel test**

Create `src/renderer/operator/SchedulePanel.test.tsx`:

```tsx
// @vitest-environment jsdom
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SchedulePanel, type ScheduleRow } from './SchedulePanel'
import { themeFor } from '../../shared/theme'

afterEach(cleanup)

function rows(overrides: Partial<ScheduleRow> = {}): ScheduleRow[] {
  return [
    {
      id: 'r1',
      title: 'John 3:16',
      meta: '1 verse · KJV',
      isCurrent: false,
      isSelected: false,
      onClick: vi.fn(),
      onContextMenu: vi.fn(),
      ...overrides
    }
  ]
}

const baseProps = {
  theme: themeFor('dark'),
  width: 270,
  track: 'scripture' as const,
  setTrack: vi.fn(),
  value: '',
  onEntryChange: vi.fn(),
  onEntryKeyDown: vi.fn(),
  canAdd: false,
  addLabel: '',
  onAdd: vi.fn(),
  rows: rows()
}

describe('SchedulePanel', () => {
  it('marks the selected row via data-selected', () => {
    render(<SchedulePanel {...baseProps} rows={rows({ isSelected: true })} />)
    const row = screen.getByText('John 3:16').closest('button') as HTMLButtonElement
    expect(row.getAttribute('data-selected')).toBe('true')
  })

  it('fires onClick on left-click and onContextMenu on right-click', () => {
    const onClick = vi.fn()
    const onContextMenu = vi.fn()
    render(<SchedulePanel {...baseProps} rows={rows({ onClick, onContextMenu })} />)
    const row = screen.getByText('John 3:16').closest('button') as HTMLButtonElement
    fireEvent.click(row)
    fireEvent.contextMenu(row)
    expect(onClick).toHaveBeenCalledTimes(1)
    expect(onContextMenu).toHaveBeenCalledTimes(1)
  })

  it('renders the undo toast and fires onUndo', () => {
    const onUndo = vi.fn()
    render(<SchedulePanel {...baseProps} undo={{ label: 'John 3:16', onUndo }} />)
    expect(screen.getByText(/Removed/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/renderer/operator/SchedulePanel.test.tsx`
Expected: FAIL — TS/prop errors (`isSelected`/`onContextMenu`/`undo` don't exist), no undo toast.

- [ ] **Step 3: Extend `SchedulePanel.tsx`**

In `src/renderer/operator/SchedulePanel.tsx`:

Change the React type import (line 1):

```ts
import type { CSSProperties, JSX, KeyboardEvent, MouseEvent as ReactMouseEvent } from 'react';
```

Extend `ScheduleRow` (add two fields after `isCurrent: boolean;`):

```ts
  isSelected: boolean;
  onContextMenu: (e: ReactMouseEvent) => void;
```

Add `undo` to `SchedulePanelProps` (after `rows: ScheduleRow[];`):

```ts
  undo?: { label: string; onUndo: () => void };
```

Add `undo` to the destructured params (after `rows`).

Replace `rowStyle` (lines 69-79) so selection shows a distinct accent ring (priority over the current-row tint):

```ts
  const rowStyle = (isCurrent: boolean, isSelected: boolean): CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    width: '100%',
    padding: '10px 11px',
    borderRadius: '11px',
    cursor: 'pointer',
    background: isCurrent ? T.panel3 : isSelected ? T.panel2 : 'transparent',
    boxShadow: isSelected
      ? `inset 0 0 0 1.5px ${T.accent}`
      : isCurrent
        ? `inset 0 0 0 1px ${T.scripture}55`
        : 'none'
  });
```

Update the row button (lines 122-131) to pass selection + wire `onContextMenu` + expose `data-selected`:

```tsx
            {rows.map((r) => (
              <button
                key={r.id}
                style={rowStyle(r.isCurrent, r.isSelected)}
                data-selected={r.isSelected || undefined}
                onClick={r.onClick}
                onContextMenu={r.onContextMenu}
              >
                <div style={iconStyle}>&#10013;</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: '13.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.title}</div>
                  <div style={{ fontSize: '11px', color: T.faint, marginTop: '1px' }}>{r.meta}</div>
                </div>
                {r.isCurrent && <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: T.live, flexShrink: 0 }} />}
              </button>
            ))}
```

Add the undo toast at the end of the scripture fragment — insert it right after the schedule list's closing `</div>` (the `overflowY: 'auto'` container ends at line 132), still inside the `track === 'scripture'` block:

```tsx
          {undo && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                margin: '0 12px 12px',
                padding: '9px 11px',
                borderRadius: '9px',
                background: T.panel2,
                boxShadow: `inset 0 0 0 1px ${T.border}`,
                flexShrink: 0
              }}
            >
              <span style={{ flex: 1, fontSize: '12px', color: T.dim, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                Removed {undo.label}
              </span>
              <button
                style={{ fontSize: '12px', fontWeight: 700, color: T.scripture, padding: '2px 4px' }}
                onClick={undo.onUndo}
              >
                Undo
              </button>
            </div>
          )}
```

- [ ] **Step 4: Run the panel test to verify it passes**

Run: `npx vitest run src/renderer/operator/SchedulePanel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Wire selection + delete + undo into `SermonMode`**

In `src/renderer/operator/SermonMode.tsx`:

Add imports (after the `SlidesTrack` import at line 25):

```ts
import { useContextMenu } from './useContextMenu';
import { useListSelection } from './useListSelection';
```

Inside `SermonMode`, after the `schedule`/`manifest` state (line 65), add:

```ts
  const contextMenu = useContextMenu();
  const sel = useListSelection();
  const [undo, setUndo] = useState<{ reading: ScriptureReading } | null>(null);
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
```

Add the remove/undo helpers next to `jumpTo` (after `jumpTo`, ~line 266):

```ts
  // Immediate remove + a ~5s "Removed — Undo" affordance (design: no blocking dialog).
  // Undo re-adds via schedule.add, which appends at the end (position-preserving restore
  // is a follow-up — see the interaction-primitives design's Known caveats).
  const removeReading = (id: string): void => {
    const reading = schedule.find((r) => r.id === id);
    if (!reading) return;
    window.helm.schedule.remove(id).then(setSchedule).catch(console.error);
    if (sel.isSelected(id)) sel.clear();
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo({ reading });
    undoTimerRef.current = setTimeout(() => setUndo(null), 5000);
  };

  const undoRemove = (): void => {
    if (!undo) return;
    const { book, ch, from, to } = undo.reading;
    window.helm.schedule.add({ book, ch, from, to }).then(setSchedule).catch(console.error);
    if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    setUndo(null);
  };
```

Add an unmount cleanup effect for the timer (right after the helpers above):

```ts
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
    };
  }, []);
```

Update `scheduleRows` (lines 403-414) so a click cues AND selects, right-click selects + opens the Delete menu, and rows carry `isSelected`:

```ts
  const scheduleRows: ScheduleRow[] = schedule.map((r) => {
    const isCurrent = r.book === scrBook && r.ch === scrCh && scrV >= r.from && scrV <= r.to;
    const n = r.to - r.from + 1;
    const primary = versions[0] ? abbrOf(versions[0]) : '';
    return {
      id: r.id,
      title: formatRef(r),
      meta: `${n} ${n === 1 ? 'verse' : 'verses'} · ${primary}`,
      isCurrent,
      isSelected: sel.isSelected(r.id),
      onClick: () => {
        jumpTo(r.book, r.ch, r.from);
        sel.select(r.id);
      },
      onContextMenu: (e) => {
        sel.select(r.id);
        contextMenu.open(e, [{ label: 'Delete', danger: true, onSelect: () => removeReading(r.id) }]);
      }
    };
  });
```

Add `onDelete` to the mode's key handler — inside the `keyHandlerRef.current = { ... }` object (in the effect at lines 454-471), after `isModalOpen: () => false`:

```ts
      onDelete: () => {
        if (track === 'scripture' && sel.selectedId) removeReading(sel.selectedId);
      }
```

Pass `undo` to `SchedulePanel` (in the `<SchedulePanel ... />` JSX at lines 504-516, after `rows={scheduleRows}`):

```tsx
            undo={undo ? { label: formatRef(undo.reading), onUndo: undoRemove } : undefined}
```

Render the menu — add `{contextMenu.menu}` just before the closing `</div>` of the `rootStyle` div (end of the returned tree, after the `</>` / conditional block closes, at line 552):

```tsx
      {contextMenu.menu}
    </div>
```

- [ ] **Step 6: Typecheck + full test run**

Run: `npm run typecheck && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/operator/SchedulePanel.tsx src/renderer/operator/SchedulePanel.test.tsx src/renderer/operator/SermonMode.tsx
git commit -m "feat(sermon): select + delete schedule items with undo"
```

---

## Task 7: End-to-end verification in the running app

No mode-container/App mount test is written (the codebase tests presentational components + repos, not the stateful mode shells). This task drives the real app to confirm the wiring the unit tests can't reach: App's `document` keydown → `onDelete`, `useContextMenu` open/close, and the live IPC round-trip.

**Files:** none (verification only).

- [ ] **Step 1: Full typecheck + test suite**

Run: `npm run typecheck && npm test`
Expected: PASS, zero type errors.

- [ ] **Step 2: Launch the app**

Use the `run` skill (or the project's dev launch command) to start Helm.

- [ ] **Step 3: Verify Songs context menu**

- Go to Songs. Right-click a song row → a themed menu appears at the cursor with **Edit**.
- Escape closes it; click elsewhere closes it; ArrowDown highlights, Enter activates.
- Activating **Edit** selects the row and logs `[songs] quick-edit requested for <id>` (DevTools console). Confirm arrows/go-live work normally again after the menu closes.

- [ ] **Step 4: Verify schedule select + delete + undo**

- Go to Sermon → Scripture. Add two readings (type a ref, Enter).
- Left-click a schedule row: it cues (jumps) AND shows the selection ring (distinct from the live dot).
- Press **Delete** (and separately **Backspace**): the selected reading is removed immediately and a **"Removed … — Undo"** bar appears; **Undo** restores it (lands at the end of the list — expected).
- Right-click a row → **Delete** (red) removes it the same way.
- Confirm typing a ref in the add-reading input and pressing Delete/Backspace edits text (does NOT delete a row).

- [ ] **Step 5: Commit any fixes found**

If Step 3/4 surface a defect, fix it under the relevant task's files with a focused test where possible, then:

```bash
git add -A
git commit -m "fix(ui): <what the manual verification caught>"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** Context-menu primitive → Task 2; Songs "Edit" consumer → Task 5; selectable-rows + Delete pattern → Tasks 3+4; schedule delete consumer → Task 6; net-new `schedule:remove` IPC → Task 1; undo UX → Task 6; a11y/keyboard → Task 2; tests → each task; App-level Delete dispatch → Task 3 (`dispatchModeKey`) + Task 7 (live). All spec sections map to a task.
- **Naming consistency:** `useContextMenu().open/close/menu`, `ContextMenuItem`, `useListSelection().{selectedId,select,clear,isSelected}`, `dispatchModeKey`, `ModeKeyHandler.onDelete`, `scheduleRepo.remove`, `CH.scheduleRemove`, `window.helm.schedule.remove`, `ScheduleRow.{isSelected,onContextMenu}`, `SchedulePanelProps.undo`, `SongSearchRailProps.onRowContextMenu` — used identically across producing and consuming tasks.
- **Known caveats carried from the spec:** undo re-adds at end-of-list (not original slot); Backspace treated as Delete, triple-guarded (not typing + mode provides `onDelete` + a row selected).
```
