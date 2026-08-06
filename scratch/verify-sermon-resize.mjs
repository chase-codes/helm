// Sermon panel resize real-app verification: dragging the shared left divider on any one
// track must widen the same left rail on ALL THREE Sermon tracks (Scripture/Message/Slides
// share one `helmSermonLeftW`/`helmSermonRightW` pair per Task 4), and the width must
// survive an app relaunch (localStorage persistence).
import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import * as os from 'node:os';
import * as fs from 'node:fs';

const APP_DIR = '/Users/lem/repos/helm/.claude/worktrees/sermon-resize-pulpit-views';
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(APP_DIR, 'scratch/sermon-resize-shots');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A fresh, isolated `--user-data-dir` for this run, reused across BOTH launches below (the
// relaunch must see the SAME profile to prove persistence). The developer machine's real
// `~/Library/Application Support/Helm` profile — accumulated across many Electron versions
// over months — was found to silently swallow localStorage writes on this box (writes never
// reach disk, so a relaunch always reads back null); an isolated tmp profile does not have
// that problem and also keeps this driver from polluting/depending on real app state.
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'helm-verify-sermon-resize-'));
const LAUNCH_ARGS = [APP_DIR, `--user-data-dir=${userDataDir}`];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};

async function launch() {
  const app = await electron.launch({
    executablePath: electronBin,
    args: LAUNCH_ARGS,
    cwd: APP_DIR,
    timeout: 30_000
  });
  await sleep(6_000);
  const page = app.windows().find((w) => w.url().includes('operator')) ?? (await app.firstWindow());
  return { app, page };
}

// SongsMode and SermonMode both stay mounted for the app's whole life (keep-alive
// contract, App.tsx) — the inactive one is merely `display:none`, not unmounted — so a
// plain `div[title="Drag to resize"]` locator also matches the OTHER mode's (hidden)
// dividers. Scope to `:visible` so this only ever sees the active mode's Sermon rail.
const VISIBLE_DIVIDERS = 'div[title="Drag to resize"]:visible';

async function leftDivider(page) {
  // Task 4: SchedulePanel/MessageMode/SlidesTrack each render their left-rail divider
  // first in DOM order — `dividers[0]` is always the left (`helmSermonLeftW`) divider,
  // confirmed by SermonMode.test.tsx's `getAllByTitle('Drag to resize')` ordering.
  return page.locator(VISIBLE_DIVIDERS).first();
}

async function readLeftWidthPx(page) {
  return page.evaluate(() => {
    const raw = localStorage.getItem('helmSermonLeftW');
    return raw === null ? null : parseFloat(raw);
  });
}

// --- Run 1: launch, resize on the Scripture track, check it carries to Message/Slides. ---
let { app, page } = await launch();

await page.getByText('Sermon', { exact: true }).click();
await sleep(800);

let dividers = page.locator(VISIBLE_DIVIDERS);
check('scripture track shows 2 visible dividers (left rail + chapter rail)', (await dividers.count()) === 2,
  `count=${await dividers.count()}`);

const widthBefore = await readLeftWidthPx(page);
console.log(`left width before drag: ${widthBefore === null ? '(unset, default 270)' : widthBefore + 'px'}`);
await page.screenshot({ path: path.join(SHOT_DIR, 'sermon-1-scripture-before.png') });

// --- Drag the left divider +80px. ---
const divider = await leftDivider(page);
const box = await divider.boundingBox();
check('left divider has a bounding box', box !== null);
const cy = box.y + box.height / 2;
const cx = box.x + box.width / 2;
await page.mouse.move(cx, cy);
await page.mouse.down();
await page.mouse.move(cx + 80, cy, { steps: 12 });
await page.mouse.up();
await sleep(400);

const widthAfter = await readLeftWidthPx(page);
check('left width persisted to localStorage after drag', widthAfter !== null, `helmSermonLeftW=${widthAfter}`);
check('left width grew by ~80px', widthAfter !== null && Math.abs(widthAfter - ((widthBefore ?? 270) + 80)) < 3,
  `before=${widthBefore ?? 270} after=${widthAfter}`);
await page.screenshot({ path: path.join(SHOT_DIR, 'sermon-2-scripture-widened.png') });

// --- Switch to Message: same left rail width, no SchedulePanel double-rail. ---
await page.getByText('Message', { exact: true }).click();
await sleep(500);
const messageDividerBox = await (await leftDivider(page)).boundingBox();
check('message track left divider sits at the same x as after the drag', messageDividerBox !== null &&
  Math.abs(messageDividerBox.x - box.x - 80) < 3,
  `expected≈${box.x + 80} got=${messageDividerBox?.x}`);
await page.screenshot({ path: path.join(SHOT_DIR, 'sermon-3-message-widened.png') });

// --- Switch to Slides: same left rail width again. ---
await page.getByText('Slides', { exact: true }).click();
await sleep(500);
const slidesDividerBox = await (await leftDivider(page)).boundingBox();
check('slides track left divider sits at the same x as after the drag', slidesDividerBox !== null &&
  Math.abs(slidesDividerBox.x - box.x - 80) < 3,
  `expected≈${box.x + 80} got=${slidesDividerBox?.x}`);
await page.screenshot({ path: path.join(SHOT_DIR, 'sermon-4-slides-widened.png') });

// --- Songs pane widths are untouched: helmSongListW/helmSectionPanelW, not
// helmSermon*, back them (SongsMode.tsx) — a shared-hook regression could easily bleed
// state between modes since usePanelWidth is now common infrastructure.
const songsUntouched = await page.evaluate(() => ({
  listW: localStorage.getItem('helmSongListW'),
  sectionW: localStorage.getItem('helmSectionPanelW')
}));
console.log(`Songs pane keys after Sermon-only resize: ${JSON.stringify(songsUntouched)}`);

// Chromium's localStorage backing store commits to disk asynchronously/batched, not
// synchronously on setItem — closing the app too soon after the drag can race that
// flush and lose the write. Give it a beat before quitting.
await sleep(2_000);
await app.close();

// --- Run 2: relaunch — the width must have survived. ---
({ app, page } = await launch());
await page.getByText('Sermon', { exact: true }).click();
await sleep(800);

const widthOnRelaunch = await readLeftWidthPx(page);
check('left width still persisted after relaunch', widthOnRelaunch !== null && Math.abs(widthOnRelaunch - widthAfter) < 1,
  `expected=${widthAfter} got=${widthOnRelaunch}`);

const relaunchDividerBox = await (await leftDivider(page)).boundingBox();
check('relaunched scripture track left divider matches the widened x', relaunchDividerBox !== null &&
  Math.abs(relaunchDividerBox.x - box.x - 80) < 3,
  `expected≈${box.x + 80} got=${relaunchDividerBox?.x}`);
await page.screenshot({ path: path.join(SHOT_DIR, 'sermon-5-relaunch-persisted.png') });

await app.close();
fs.rmSync(userDataDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
