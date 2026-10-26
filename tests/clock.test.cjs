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
    assert.ok(before <= Math.ceil(scene.clockAtStart) && before >= scene.clockAtStart - 4, `시계 ${before}초 ≠ 원래 ${scene.clockAtStart}초`);
    // 한 수 두면 +5초
    const legal = (await page.getAttribute('#board', 'data-legal')).split(' ');
    const sq = async (s) => { const b = await page.locator(`#board rect[data-square="${s}"]`).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
    await sq(legal[0].slice(0, 2)); await sq(legal[0].slice(2, 4));
    await page.waitForFunction((b) => {
      const [m, s] = document.querySelector('#clock').textContent.split(':').map(Number);
      return m * 60 + s > b;
    }, before, { timeout: 10_000 });
    console.log('시계', before, '초 → 한 수 뒤', await page.textContent('#clock'));

    // 예전 장면(시계 정보 없음)도 다시 열면 채워져 원래 시계로 둔다
    await page.evaluate(async () => {
      const store = await import('./src/store.js');
      const all = await store.getAll('scenes');
      await store.putMany('scenes', all.map(({ tc, clockAtStart, ...rest }) => rest));
    });
    await page.goto(base);
    await page.waitForSelector('#board[data-active="true"]', { timeout: 120_000 });
    assert.strictEqual(await page.textContent('#clockInc'), '+5초');
    const again = await page.evaluate(async () => (await (await import('./src/store.js')).getAll('scenes')).find((x) => x.ply === 27));
    assert.strictEqual(again.clockAtStart, scene.clockAtStart);
    console.log('예전 장면 채움 → 시작 때 남은 시간', again.clockAtStart, '초');

    // 예전 방식 장면(시작 전 원래 수순 없음)은 뒤에서 다시 만들어진다
    await page.evaluate(async () => {
      const store = await import('./src/store.js');
      const all = await store.getAll('scenes');
      await store.putMany('scenes', all.map(({ preLine, preFen, ...rest }) => ({ ...rest, startPly: rest.ply - 8 })));
    });
    await page.goto(base);
    // 게임을 다시 분석해 끝낼 때까지(새 장면엔 시작 전 수순이 있고, 시작 지점이 섞인다)
    for (let t = 0; ; t++) {
      const ready = await page.evaluate(async () => {
        const store = await import('./src/store.js');
        const games = await store.getAll('games');
        const all = await store.getAll('scenes');
        return games.every((g) => g.status !== 'new') && all.length > 2 && all.every((x) => Array.isArray(x.preLine));
      });
      if (ready) break;
      assert.ok(t < 120, '다시 만들기가 끝나지 않음');
      await page.waitForTimeout(1000);
    }
    const rebuilt = await page.evaluate(async () => (await (await import('./src/store.js')).getAll('scenes')).map((x) => `${x.ply}:${x.ply - x.startPly}`).join(' '));
    console.log('다시 만든 장면(반수:장면까지 반수):', rebuilt);
    assert.ok(new Set(rebuilt.split(' ').map((x) => x.split(':')[1])).size > 1, '시작 지점이 섞이지 않음');

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
