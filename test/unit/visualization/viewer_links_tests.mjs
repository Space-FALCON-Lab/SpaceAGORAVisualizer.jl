// Run with: node test/unit/visualization/viewer_links_tests.mjs
// Uses the shipped viewer and vendored Three, without WebGL or downloads.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { mkdtemp, mkdir, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const scratch = await mkdtemp(join(tmpdir(), 'spaceagora-viewer-links-'));
after(() => rm(scratch, { recursive: true, force: true }));
await writeFile(join(scratch, 'package.json'), '{"type":"module"}');
for (const dir of ['src', 'vendor']) {
  await mkdir(join(scratch, dir));
  for (const name of await readdir(join(repo, 'viewer', dir))) {
    if (!name.endsWith('.js')) continue;
    let source = await readFile(join(repo, 'viewer', dir, name), 'utf8');
    source = source.replace(/(['"])(three|three\/addons\/[^'"]+|viewer\/[^'"]+)\1/g, (_, quote, spec) => {
      const path = spec === 'three' ? 'vendor/three.module.js' : spec.startsWith('viewer/')
        ? `src/${spec.slice(7)}` : `vendor/${spec.split('/').at(-1)}`;
      return quote + pathToFileURL(join(scratch, path)).href + quote;
    });
    await writeFile(join(scratch, dir, name), source);
  }
}
const load = (path) => import(pathToFileURL(join(scratch, path)).href);
const { FrameData } = await load('src/data.js');
const { createLinks, inWindow, linkWindows, linkColor } = await load('src/links.js');
const payload = JSON.parse(await readFile(join(repo, 'test', 'fixtures', 'interlinks_viewer.json'), 'utf8'));
const frames = new FrameData(payload.frames);
const segment = (line, i) => Array.from(line.geometry.getAttribute('position').array.slice(6 * i, 6 * i + 6));
const near = (a, b) => a.every((x, k) => Math.abs(x - b[k]) < 1e-6);

test('window lookup: start inclusive, end exclusive, the last time included', () => {
  const list = [[0, 5], [5, 10]];
  assert.equal(inWindow(list, 0, 10), true);
  assert.equal(inWindow(list, 4.999, 10), true);
  assert.equal(inWindow(list, 5, 10), true);       // the second window starts there
  assert.equal(inWindow([[0, 5]], 5, 10), false);  // a window's end is exclusive
  assert.equal(inWindow([[0, 5]], 5, 5), true);    // except at the schedule's last time
  assert.equal(inWindow([[2, 2]], 2, 2), true);    // a one-sample window at the last time
  assert.equal(inWindow(list, -1, 10), false);
  assert.equal(inWindow([], 3, 10), false);
});

test('windows decode from base64 and plain arrays, per link and sorted', () => {
  const active = linkWindows(payload.interlinks.active, 2);
  assert.deepEqual(active, [[[0, 5]], [[5, 10]]]);
  const contact = linkWindows(payload.interlinks.contact, 2);
  assert.deepEqual(contact, [[], [[0, 10]]]);
  assert.deepEqual(linkWindows(null, 2), [[], []]);
  assert.deepEqual(linkWindows({ count: 2, index: [0, 0], start_s: [8, 1], end_s: [9, 2] }, 1), [[[1, 2], [8, 9]]]);
});

test('colours follow the kind, with or without type parameters', () => {
  assert.equal(linkColor('LaserMomentumLink'), linkColor('LaserMomentumLink'));
  assert.equal(linkColor('DataLink{FixedRateBudget}'), linkColor('DataLink'));
  assert.notEqual(linkColor('DataLink'), linkColor('PowerBeamLink'));
  assert.equal(linkColor('MyLink'), linkColor('OtherLink'));
  assert.notEqual(linkColor('MyLink'), linkColor('LaserMomentumLink'));
});

test('segments join the spacecraft while active, dimmed while only in contact', () => {
  const links = createLinks(payload.interlinks, frames, {});
  assert.equal(links.count, 2);
  assert.equal(links.lastTime, 10);
  const [contactLine, activeLine] = links.group.children;
  const anchor = [7000, 0, 0];
  const pos = new Float64Array(3);
  const relative = (t, sat) => { frames.positionAt(t, sat, pos); return [pos[0] - anchor[0], pos[1] - anchor[1], pos[2] - anchor[2]]; };
  // t = 2: the laser link is active, the data link only in contact.
  assert.equal(links.update(2, anchor), 1);
  assert.ok(near(segment(activeLine, 0), [...relative(2, 0), ...relative(2, 1)]));
  assert.deepEqual(segment(activeLine, 1), [0, 0, 0, 0, 0, 0]);
  assert.ok(near(segment(contactLine, 1), [...relative(2, 0), ...relative(2, 2)]));
  assert.deepEqual(segment(contactLine, 0), [0, 0, 0, 0, 0, 0]);
  assert.deepEqual(links.group.position.toArray(), anchor);
  // t = 7: the data link is active, the laser link drawn by neither line.
  assert.equal(links.update(7, anchor), 1);
  assert.deepEqual(segment(activeLine, 0), [0, 0, 0, 0, 0, 0]);
  assert.ok(near(segment(activeLine, 1), [...relative(7, 0), ...relative(7, 2)]));
  assert.deepEqual(segment(contactLine, 1), [0, 0, 0, 0, 0, 0]);
  // t = 10, the schedule's last time: the data link is still drawn.
  assert.equal(links.update(10, anchor), 1);
  assert.equal(links.activeAt(1, 10), true);
  assert.equal(links.contactAt(1, 2), true);
  // A directed link fades toward its receiver; an undirected one does not.
  const colors = activeLine.geometry.getAttribute('color').array;
  assert.deepEqual(Array.from(colors.slice(0, 3)), Array.from(colors.slice(3, 6)));
  assert.notDeepEqual(Array.from(colors.slice(6, 9)), Array.from(colors.slice(9, 12)));
  // The toggle hides the group.
  links.setVisible(false);
  assert.equal(links.group.visible, false);
});

test('the history span sets the last time and the legend', () => {
  // Without a span (an older payload), the last time is the latest window end.
  const plain = createLinks(payload.interlinks, frames, {});
  assert.equal(plain.historyStart, null);
  assert.equal(plain.statusAt(7), '1 of 2 active');
  assert.deepEqual(plain.kinds, [['LaserMomentumLink', linkColor('LaserMomentumLink')],
    ['DataLink{FixedRateBudget}', linkColor('DataLink')]]);
  // A history that ran past the last window: a window ending at 10 s is not
  // drawn at 10 s, since the link was off by then.
  const later = createLinks({ ...payload.interlinks, history_start_s: 0, history_end_s: 12 }, frames, {});
  assert.equal(later.lastTime, 12);
  assert.equal(later.activeAt(1, 10), false);
  assert.equal(later.update(10, [0, 0, 0]), 0);
  assert.equal(later.statusAt(10), '0 of 2 active');
  // A schedule that starts after the frames (a resume that could not keep it).
  const resumed = createLinks({ ...payload.interlinks, history_start_s: 3, history_end_s: 10 }, frames, {});
  assert.equal(resumed.statusAt(2), 'not recorded before 3 s');
  assert.equal(resumed.statusAt(3), '1 of 2 active');
  // null, as SpaceAGORA writes an unknown span, falls back.
  assert.equal(createLinks({ ...payload.interlinks, history_start_s: null, history_end_s: null }, frames, {}).lastTime, 10);
});

test('without the block nothing is drawn', () => {
  const links = createLinks(undefined, frames, {});
  assert.equal(links.count, 0);
  assert.equal(links.update(5, [0, 0, 0]), 0);
});
