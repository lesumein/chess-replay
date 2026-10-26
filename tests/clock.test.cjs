// 시계 고르기: '원래 게임 시계'면 그 순간 원래 남은 시간에서 시작하고 수마다 추가시간이 붙는다.
//   node tests/clock.test.cjs
const assert = require('assert');
const { chromium, devices } = require('playwright');
const { serve, fakeChessCom } = require('./helpers.cjs');

const secs = (t) => { const [m, s] = t.split(':').map(Number); return m * 60 + s; };

(async () => {
  const server = await serve();
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeChessCom(page);
  const base = `http://localhost:${server.address().port}/index.html?scene=27&fast&nosw`;
  try {
    await page.goto(base);
    await page.evaluate(() => { localStorage.setItem('user', 'lesum_ein'); localStorage.setItem('clockMode', 'original'); });
    await page.goto(base);
    await page.waitForSelector('#board[data-active="true"]', { timeout: 120_000 });
    const scene = await page.evaluate(async () => (await (await import('./src/store.js')).getAll('scenes')).find((x) => x.ply === 27));
    console.log('원래 시계:', scene.tc, '시작 때 남은 시간', scene.clockAtStart, '초');
    assert.deepStrictEqual(scene.tc, { base: 300, inc: 5 });
    assert.match(await page.textContent('#gameInfo'), /블리츠 5\+5/);
    assert.strictEqual(await page.textContent('#clockInc'), '+5초');
    const before = secs(await page.textContent('#clock'));
    assert.ok(Math.abs(before - Math.ceil(scene.clockAtStart)) <= 1, `시계 ${before}초 ≠ 원래 ${scene.clockAtStart}초`);
    // 한 수 두면 +5초
    const legal = (await page.getAttribute('#board', 'data-legal')).split(' ');
    const sq = async (s) => { const b = await page.locator(`#board rect[data-square="${s}"]`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    await sq(legal[0].slice(0, 2)); await sq(legal[0].slice(2, 4));
    await page.waitForFunction((b) => {
      const [m, s] = document.querySelector('#clock').textContent.split(':').map(Number);
      return m * 60 + s > b;
    }, before, { timeout: 10_000 });
    console.log('시계', before, '초 → 한 수 뒤', await page.textContent('#clock'));

    // 앱 시계로 바꾸면 추가시간 없음
    await page.evaluate(() => localStorage.setItem('clockMode', 'app'));
    await page.goto(base);
    await page.waitForSelector('#board[data-active="true"]', { timeout: 120_000 });
    assert.ok(await page.isHidden('#clockInc'));
    console.log('앱 시계:', await page.textContent('#clock'));
    assert.deepStrictEqual(errors, []);
    console.log('ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
