// 폰 화면 크기에서 측정 화면을 끝까지 돌려 본다.
// Chess.com API는 tests/fixtures로 대신한다. 걸린 시간은 이 컴퓨터 기준이라 폰 속도는 폰에서 따로 잰다.
// (CDP의 CPU 감속은 Web Worker에 걸리지 않아 쓰지 않는다.)
//   node tests/bench.test.cjs
//   DEPTHS=10,12,16,20 node tests/bench.test.cjs
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');
const { serve, fakeChessCom } = require('./helpers.cjs');

const DEPTHS = (process.env.DEPTHS || '10,12,16').split(',');

(async () => {
  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  page.on('pageerror', (e) => console.error('pageerror:', e.message));

  await fakeChessCom(page);

  try {
    await page.goto(`http://localhost:${server.address().port}/bench.html`);
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= page.viewportSize().width, `가로 스크롤이 생김: ${width}px`);

    await page.fill('#user', 'lesum_ein');
    await page.click('#fetchBtn');
    await page.waitForSelector('#pick:not([hidden])');
    assert.match(await page.textContent('#game'), /blitz · 흑 · 승/);

    for (const box of await page.$$('input[name=depth]')) {
      await box.setChecked(DEPTHS.includes(await box.getAttribute('value')));
    }
    await page.click('#runBtn');
    await page.waitForSelector('#summary', { timeout: 600_000 });

    const rows = await page.$$eval('#timing tbody tr', (trs) => trs.map((tr) => tr.innerText.replace(/\s+/g, ' ')));
    assert.strictEqual(rows.length, DEPTHS.length);
    const scenes = await page.$$eval('#scenes li', (lis) => lis.map((li) => li.innerText.replace(/\s+/g, ' ')));
    console.log(await page.textContent('#summary'));
    console.log(scenes.join('\n'));

    // 인계 문서에서 짚은 세 장면
    assert.ok(scenes.some((s) => s.includes('14...') && s.includes('Nxf3+')), '14...Nxf3+ 놓친 기회');
    // 23...Qa4(6수 메이트)는 깊이 20쯤 돼야 보인다. 얕으면 Bf7을 대신 내놓으므로 장면 자체만 본다.
    assert.ok(scenes.some((s) => s.includes('23...Na3')), '23...Na3 놓친 기회');
    assert.ok(scenes.some((s) => s.includes('27...c5')), '27...c5 큰 실수');

    await page.screenshot({ path: path.join(process.env.SCREENSHOT_DIR || __dirname, 'bench.png'), fullPage: true });
    console.log('ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
