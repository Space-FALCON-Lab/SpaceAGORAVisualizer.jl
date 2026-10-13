// Local real-browser regression; uses an already installed Playwright and Chrome.
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { chromium } = require('playwright');
(async () => {
  const [fullPath, terminalPath, strictPath, outsidePath] = process.argv.slice(2);
  assert.ok(fullPath && terminalPath && strictPath && outsidePath, 'Pass the four generated precision fixture HTML paths.');
  const browser = await chromium.launch({ headless: true,
    ...(process.env.SPACEAGORA_BROWSER_EXECUTABLE ? { executablePath: process.env.SPACEAGORA_BROWSER_EXECUTABLE } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const errors = [], external = [], checked = [];
  async function open(path) {
    const page = await browser.newPage({ viewport: { width: 1100, height: 750 } });
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.route(/^https?:/, route => { external.push(route.request().url()); return route.abort(); });
    await page.goto(pathToFileURL(resolve(path)).href);
    await page.waitForFunction(() => window.spaceagoraViewer !== undefined, { timeout: 15000 });
    await page.evaluate(() => window.spaceagoraViewer.setRecording(true));
    return page;
  }
  const at = page => page.evaluate(() => window.spaceagoraViewer.timeline.t);
  const status = page => page.textContent('[data-role="mission-status"]');
  const disabled = (page, role, value) => page.locator(`[data-role="${role}"] option[value="${value}"]`).evaluate(option => option.disabled);
  try {
    const full = await open(fullPath);
    const original = await full.evaluate(() => JSON.stringify(window.spaceagoraViewer.mission));
    assert.equal(await full.evaluate(() => window.spaceagoraViewer.frames.t.constructor.name), 'Float32Array');
    assert.equal(await disabled(full, 'mission-segment', '0'), false);
    assert.equal(await disabled(full, 'mission-transition', '1'), false);
    assert.equal(await full.locator('[data-role="mission-coverage"]').isVisible(), false);
    await full.selectOption('[data-role="mission-segment"]', '0');
    assert.equal(await at(full), Math.fround(0.1)); assert.ok((await status(full)).startsWith('coast'));
    for (const role of ['mission-segment', 'mission-transition']) {
      const value = role === 'mission-segment' ? '1' : '0';
      for (let repeat = 0; repeat < 2; repeat++) {
        await full.evaluate(() => window.spaceagoraViewer.renderAt(0.8));
        await full.selectOption(`[data-role="${role}"]`, value);
        assert.equal(await at(full), Math.fround(0.7));
        assert.ok((await status(full)).startsWith('maneuver'));
        assert.equal(await full.inputValue(`[data-role="${role}"]`), '');
      }
    }
    await full.evaluate(() => window.spaceagoraViewer.renderAt(Math.fround(0.7)));
    assert.ok((await status(full)).startsWith('maneuver'));
    assert.equal(await full.evaluate(() => JSON.stringify(window.spaceagoraViewer.mission)), original);
    checked.push('Float32 first/internal/final boundaries and repeated jumps'); await full.close();

    const terminal = await open(terminalPath);
    assert.equal(await disabled(terminal, 'mission-transition', '0'), false);
    assert.equal(await terminal.locator('[data-role="mission-coverage"]').isVisible(), false);
    await terminal.selectOption('[data-role="mission-transition"]', '0');
    assert.equal(await at(terminal), Math.fround(0.7)); assert.ok((await status(terminal)).startsWith('coast'));
    assert.equal(await terminal.evaluate(() => window.spaceagoraViewer.mission.transitions[0].time_s), 0.7);
    checked.push('Float32 terminal 0.7 remains available and metadata stays exact'); await terminal.close();

    const strict = await open(strictPath);
    assert.equal(await strict.evaluate(() => window.spaceagoraViewer.frames.t.constructor.name), 'Float64Array');
    assert.equal(await disabled(strict, 'mission-segment', '0'), true);
    assert.equal(await disabled(strict, 'mission-transition', '0'), true);
    assert.equal(await strict.locator('[data-role="mission-coverage"]').isVisible(), true);
    checked.push('Float64 distinct times remain unavailable'); await strict.close();

    const outside = await open(outsidePath);
    assert.equal(await disabled(outside, 'mission-segment', '0'), false);
    assert.equal(await disabled(outside, 'mission-transition', '0'), true);
    assert.equal(await outside.locator('[data-role="mission-coverage"]').isVisible(), true);
    assert.ok((await outside.locator('[data-role="mission-transition"] option[value="0"]').textContent()).includes('outside saved playback'));
    const before = await at(outside);
    await outside.evaluate(() => {
      const select = document.querySelector('[data-role="mission-transition"]');
      select.value = '0'; select.dispatchEvent(new Event('change'));
    });
    assert.equal(await at(outside), before);
    checked.push('Float32 genuinely uncovered 0.71 remains disabled'); await outside.close();
    assert.deepEqual(external, []); assert.deepEqual(errors, []);
    console.log(JSON.stringify({ passed: true, checked, unexpected_network_requests: external, errors }, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
