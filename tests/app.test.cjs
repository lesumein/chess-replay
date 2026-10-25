// 폰 화면 크기에서 앱을 처음부터 끝까지 써 본다.
// 아이디 입력 → 뒤에서 분석 → 14수 장면을 4수 전부터 두기 → 결과 한 줄 → 홈 통계.
//   node tests/app.test.cjs
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');
const { serve, fakeChessCom } = require('./helpers.cjs');

const SHOTS = process.env.SCREENSHOT_DIR || __dirname;

async function clickSquare(page, sq) {
  const box = await page.locator(`#board rect[data-square="${sq}"]`).boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
}

// 내 차례가 될 때까지 기다렸다가 from → to를 탭한다.
async function move(page, uci) {
  await page.waitForSelector('#board[data-active="true"]', { timeout: 120_000 });
  await clickSquare(page, uci.slice(0, 2));
  await clickSquare(page, uci.slice(2, 4));
}

// 둘 수 있는 아무 수
async function anyMove(page) {
  await page.waitForSelector('#board[data-active="true"], #result:not([hidden])', { timeout: 120_000 });
  if (await page.isVisible('#result')) return false;
  const legal = (await page.getAttribute('#board', 'data-legal')).split(' ');
  await move(page, legal[0]);
  return true;
}

(async () => {
  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeChessCom(page);

  try {
    // scene=27: 14...수(27번째 반수) 장면을 고른다. fast: 봇이 기다리지 않는다.
    await page.goto(`http://localhost:${server.address().port}/index.html?scene=27&fast&nosw`);
    await page.fill('#user', 'lesum_ein');
    await page.click('#setupForm button');
    await page.screenshot({ path: path.join(SHOTS, 'app-waiting.png') });

    // 분석이 끝나면 바로 장면이 시작된다.
    await page.waitForSelector('#play:not([hidden])', { timeout: 120_000 });
    const width = await page.evaluate(() => document.documentElement.scrollWidth);
    assert.ok(width <= page.viewportSize().width, `가로 스크롤이 생김: ${width}px`);
    // 흑이므로 a1이 오른쪽 위
    await page.waitForSelector('#board[data-active="true"]', { timeout: 60_000 });
    const a1 = await page.locator('#board rect[data-square="a1"]').boundingBox();
    const h8 = await page.locator('#board rect[data-square="h8"]').boundingBox();
    assert.ok(a1.x > h8.x && a1.y < h8.y, 'a1이 오른쪽 위가 아님');
    // 장면 표시가 없어야 한다
    assert.ok(!/14|장면|찾/.test(await page.innerText('#play')), '두는 동안 장면 신호가 보임');

    await page.screenshot({ path: path.join(SHOTS, 'app-play.png') });

    // 원래 게임대로 10...Nge5 11...d3 12...Na5 13...Be6, 그리고 14...Nxf3+
    for (const uci of ['g4e5', 'd4d3', 'c6a5', 'c8e6']) await move(page, uci);
    assert.ok(await page.$('#board g[data-square="f3"][data-piece="wn"]'), '원래 게임대로라면 f3에 백 나이트가 있어야 함');
    await move(page, 'e5f3');
    while (await anyMove(page));

    await page.waitForSelector('#result:not([hidden])', { timeout: 120_000 });
    const text = await page.textContent('#resultText');
    console.log('결과:', text);
    assert.match(text, /14수에서 Nxf3\+를 찾았어요/);
    assert.strictEqual(await page.textContent('#resultTitle'), '찾았어요');
    // 장면 포지션으로 돌아가 좋은 수를 화살표로 보여 준다
    await page.waitForSelector('#board .arrow-success');
    assert.ok(await page.$('#board g[data-square="e5"][data-piece="bn"]'), '장면 포지션이 아님');
    await page.screenshot({ path: path.join(SHOTS, 'app-result.png') });
    // 좋은 수 수순: Nxf3+ 다음 상대의 응수, 그다음 이득까지
    const line = await page.innerText('#lineText');
    console.log('수순:', line);
    assert.match(line, /^14\.\.\.\s*Nxf3\+ 15\./);
    await page.click('#nextStep');
    await page.waitForSelector('#board g[data-square="f3"][data-piece="bn"]');
    assert.strictEqual(await page.textContent('#stepInfo'), '1 / ' + line.split(/\s+/).filter((t) => !/^\d+\.+$/.test(t)).length);
    await page.click('#prevStep');
    await page.waitForSelector('#board g[data-square="e5"][data-piece="bn"]');
    // 찾았으니 '둔 수' 탭은 없다
    assert.ok(await page.isHidden('#tabs [data-view="bad"]'));
    await page.click('#tabs [data-view="end"]');
    await page.waitForFunction(() => !document.querySelector('#board .arrow-success'));
    // 빈 줄이 있어도 칸이 정사각형
    const sizes = await page.$$eval('#board rect[data-square]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `칸 높이가 다름: ${Math.min(...sizes)}~${Math.max(...sizes)}`);

    await page.click('#homeBtn');
    await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('/'));
    const stats = (await page.textContent('#stats')).replace(/\s+/g, ' ');
    console.log('홈:', stats);
    assert.match(stats, /1\/1\s*찾은 장면/);
    assert.match(await page.textContent('#recent'), /14수 놓친 기회 · 찾았어요/);
    assert.match(stats, /1\s*최근 2주 연 날/);
    await page.screenshot({ path: path.join(SHOTS, 'app-home.png') });

    const scenes = await page.evaluate(async () => (await import('./src/store.js')).getAll('scenes'));
    console.log('장면:', scenes.map((x) => `${x.moveNo}${x.side ? '...' : '.'}${x.playedSan}→${x.fake ? '(가짜)' : x.bestSan}`).join(' '));
    assert.deepStrictEqual(errors, []);
    console.log('ok');
  } finally {
    await browser.close();
    server.close();
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
