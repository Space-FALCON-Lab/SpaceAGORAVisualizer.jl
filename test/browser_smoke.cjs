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
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    if (process.env.SPACEAGORA_BROWSER_SCREENSHOT) await page.screenshot({ path: process.env.SPACEAGORA_BROWSER_SCREENSHOT });
    console.log(JSON.stringify({ passed: true, ...result, unexpected_network_requests: external, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
