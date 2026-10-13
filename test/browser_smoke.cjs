// Run with an installed Playwright and Chromium/Chrome. No package or browser installation occurs here.
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const input = process.argv[2];
  if (!input) throw new Error('Pass a generated viewer HTML fixture.');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.SPACEAGORA_BROWSER_EXECUTABLE ? { executablePath: process.env.SPACEAGORA_BROWSER_EXECUTABLE } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
    const errors = [], external = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
    await page.goto(pathToFileURL(resolve(input)).href);
    await page.waitForFunction(() => window.spaceagoraViewer !== undefined, { timeout: 15000 });
    const result = await page.evaluate(() => {
      const v = window.spaceagoraViewer;
      v.setRecording(true); v.renderAt(5);
      const initial = v.timeline.t;
      v.state.frame = 'planet_fixed'; v.renderAt(10);
      return { count: v.frames.count, sats: v.frames.sats, canvas: !!document.querySelector('canvas'),
        initial, final: v.timeline.t, frame: v.state.frame, width: v.renderer.domElement.width,
        renderer: v.renderer.getContext().getParameter(v.renderer.getContext().VERSION) };
    });
    assert.equal(result.count, Number(process.argv[3] || 2)); assert.equal(result.sats, Number(process.argv[4] || 1)); assert.equal(result.canvas, true);
    assert.equal(result.frame, 'planet_fixed'); assert.ok(result.width > 0);
    assert.equal(result.initial, 5); assert.equal(result.final, 10);
    const mission = await page.evaluate(() => window.spaceagoraViewer.mission);
    if (mission && mission.segments.length) {
      const bounds = await page.evaluate(() => [window.spaceagoraViewer.timeline.tStart, window.spaceagoraViewer.timeline.tEnd]);
      const outside = time => time < bounds[0] || time > bounds[1];
      if (!outside(mission.segments[0].start_s)) {
        await page.selectOption('[data-role="mission-segment"]', '0');
        assert.equal(await page.evaluate(() => window.spaceagoraViewer.timeline.t), mission.segments[0].start_s);
        assert.equal(await page.inputValue('[data-role="mission-segment"]'), '');
        // Seeking again to the current segment must work after playback advances.
        await page.evaluate(() => {
          const v = window.spaceagoraViewer, first = v.mission.segments[0];
          v.renderAt((first.start_s + Math.min(first.end_s, v.timeline.tEnd)) / 2);
        });
        await page.selectOption('[data-role="mission-segment"]', '0');
        assert.equal(await page.evaluate(() => window.spaceagoraViewer.timeline.t), mission.segments[0].start_s);
      }
      const disabled = await page.locator('[data-role="mission-transition"] option').evaluateAll(options => options.slice(1).map(option => option.disabled));
      assert.deepEqual(disabled, mission.transitions.map(transition => outside(transition.time_s)));
      const uncovered = mission.segments.some(segment => outside(segment.start_s) || outside(segment.end_s));
      assert.equal(await page.locator('[data-role="mission-coverage"]').isVisible(), uncovered);
      if (mission.transitions.length && !outside(mission.transitions[0].time_s)) {
        await page.selectOption('[data-role="mission-transition"]', '0');
        assert.equal(await page.evaluate(() => window.spaceagoraViewer.timeline.t), mission.transitions[0].time_s);
        assert.equal(await page.inputValue('[data-role="mission-transition"]'), '');
        assert.ok((await page.textContent('[data-role="mission-status"]')).includes(mission.transitions[0].to ?? mission.transitions[0].from));
        await page.evaluate(() => {
          const v = window.spaceagoraViewer;
          v.renderAt(Math.min(v.timeline.tEnd, v.mission.transitions[0].time_s + 1));
        });
        await page.selectOption('[data-role="mission-transition"]', '0');
        assert.equal(await page.evaluate(() => window.spaceagoraViewer.timeline.t), mission.transitions[0].time_s);
      }
      await page.evaluate(() => {
        const v = window.spaceagoraViewer;
        v.renderAt(v.mission.segments.at(-1).end_s);
      });
      assert.equal(await page.inputValue('[data-role="mission-segment"]'), '');
      assert.ok((await page.textContent('[data-role="mission-status"]')).includes(mission.segments.at(-1).name));
      // Saved names are text, including strings that resemble markup.
      assert.equal(await page.locator('[data-role="mission"] img').count(), 0);
    } else {
      assert.equal(await page.locator('[data-role="mission"]').isVisible(), false);
    }
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    if (process.env.SPACEAGORA_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.SPACEAGORA_BROWSER_SCREENSHOT });
    console.log(JSON.stringify({ passed: true, ...result, unexpected_network_requests: external, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
