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
    assert.match(await page.textContent('#gameInfo'), /블리츠 5\+5 · 이긴 판$/);

    // 기물 우위: 3.Bxf7+ Kxf7로 흑(나)이 비숍을, 백이 폰을 잡아 흑 +3 (7...exd4로 폰 하나 더)
    await page.waitForFunction(() => document.querySelector('#meMaterial').textContent.includes('+3'));
    assert.ok(await page.$('#meMaterial use[href="#wb"]'), '내가 잡은 백 비숍');
    assert.ok(await page.$('#oppMaterial use[href="#bp"]'), '상대가 잡은 흑 폰');
    assert.ok(!(await page.textContent('#oppMaterial')).includes('+'));
    await page.screenshot({ path: path.join(SHOTS, 'app-play.png') });

    // 시작은 장면 2~4수 전. 원래 게임대로 10...Nge5 11...d3 12...Na5 13...Be6 중 시작부터, 그리고 14...Nxf3+
    const scene27 = await page.evaluate(async () => (await (await import('./src/store.js')).getAll('scenes')).find((x) => x.ply === 27));
    console.log('시작:', scene27.startPly, '앞 수순', scene27.preLine.length, '반수');
    assert.ok([19, 21, 23].includes(scene27.startPly));
    const lead = { 19: ['g4e5', 'd4d3', 'c6a5', 'c8e6'], 21: ['d4d3', 'c6a5', 'c8e6'], 23: ['c6a5', 'c8e6'] }[scene27.startPly];
    await move(page, lead[0]);
    // 지난 수 되돌려 보기: 한 칸 전(상대 수 전)으로 갔다가 돌아오면 다시 둘 수 있다
    await page.waitForSelector('#board[data-active="true"]');
    const fenNow = await page.evaluate(() => [...document.querySelectorAll('#board g[data-piece]')].map((g) => g.dataset.square + g.dataset.piece).sort().join());
    await page.click('#histPrev');
    await page.waitForFunction((f) => [...document.querySelectorAll('#board g[data-piece]')].map((g) => g.dataset.square + g.dataset.piece).sort().join() !== f, fenNow);
    assert.strictEqual(await page.getAttribute('#board', 'data-active'), 'false');
    assert.ok(await page.isVisible('#histNote'));
    await page.click('#histNext');
    await page.waitForSelector('#board[data-active="true"]');
    for (const uci of lead.slice(1)) await move(page, uci);
    assert.ok(await page.$('#board g[data-square="f3"][data-piece="wn"]'), '원래 게임대로라면 f3에 백 나이트가 있어야 함');
    await move(page, 'e5f3');
    while (await anyMove(page));

    await page.waitForSelector('#result:not([hidden])', { timeout: 120_000 });
    const text = await page.textContent('#resultText');
    console.log('결과:', text);
    assert.match(text, /14수에서 Nxf3\+를 찾았어요/);
    assert.strictEqual(await page.textContent('#resultTitle'), '찾았어요');
    // 원래 게임과 비교(테스트는 장면 뒤로 아무 수나 두므로 판정 글자만 확인)
    const compare = await page.innerText('#compare');
    console.log('비교:', compare.replace(/\s+/g, ' '));
    // 원래 14...Qd7로 잃은 만큼 이번이 낫다(뒤의 아무 수가 일부를 잃어도 플러스)
    assert.match(compare, /^원래 대비 \+\d+\.\d\s+원래보다 잘 뒀어요$/);
    // 장면 포지션으로 돌아가 좋은 수를 화살표로 보여 준다
    await page.waitForSelector('#board .arrow-success');
    assert.ok(await page.$('#board g[data-square="e5"][data-piece="bn"]'), '장면 포지션이 아님');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'app-result.png') });
    // 좋은 수 수순: 시작한 판부터 장면까지(원래 흐름), 그다음 Nxf3+와 이득까지. 장면 포지션에서 열린다
    const line = await page.innerText('#lineText');
    console.log('수순:', line.replace(/\s+/g, ' '));
    assert.match(line, /^1[0-2]\.\.\.\s*(Nge5|d3|Na5) /);
    assert.match(line, /장면\s*14\.\.\.\s*Nxf3\+ 15\./);
    const [at] = (await page.textContent('#stepCount')).split(' / ').map(Number);
    await page.click('#nextStep');
    await page.waitForSelector('#board g[data-square="f3"][data-piece="bn"]');
    assert.ok((await page.textContent('#stepCount')).startsWith(`${at + 1} / `));
    assert.strictEqual(await page.textContent('#stepInfo'), '14... Nxf3+');
    // ◀ ▶ 바는 화면 아래에 떠 있다
    const bar = await page.locator('#stepper').boundingBox();
    const vh = page.viewportSize().height;
    assert.ok(bar.y + bar.height <= vh && bar.y > vh - 120, `조작 바가 화면 아래에 없음: ${bar.y}`);
    // 판 왼쪽을 누르면 이전 수, 오른쪽은 다음 수
    const bb = await page.locator('#board').boundingBox();
    await page.mouse.click(bb.x + bb.width * 0.15, bb.y + bb.height / 2);
    await page.waitForSelector('#board g[data-square="e5"][data-piece="bn"]');
    await page.mouse.click(bb.x + bb.width * 0.85, bb.y + bb.height / 2);
    await page.waitForSelector('#board g[data-square="f3"][data-piece="bn"]');
    await page.click('#prevStep');
    await page.waitForSelector('#board g[data-square="e5"][data-piece="bn"]');
    // ◀로 장면 앞(원래 흐름)으로 거슬러 갈 수 있다
    await page.click('#prevStep');
    await page.waitForSelector('#board g[data-square="c8"][data-piece="bb"], #board g[data-square="e6"][data-piece="bb"]');
    // 원래 vs 이번: 작은 판 두 개와 수순 표, 14수에서 갈렸다
    await page.click('#tabs [data-view="cmp"]');
    await page.waitForSelector('#cmpPanel:not([hidden])');
    assert.ok(await page.isHidden('#board'), '비교할 때는 큰 판을 숨긴다');
    await page.waitForSelector('#cmpOrig g[data-square="d7"][data-piece="bq"]');
    await page.waitForSelector('#cmpMine g[data-square="f3"][data-piece="bn"]');
    const split = (await page.innerText('#cmpMoves tr.split')).replace(/\s+/g, ' ');
    console.log('갈림:', split, '·', await page.textContent('#stepInfo'), '·', await page.textContent('#cmpOrigScore'), await page.textContent('#cmpMineScore'));
    assert.match(split, /^14\.\.\. Qd7\s*[+−]?\d+\.\d Nxf3\+\s*[+−]?\d+\.\d Nxf3\+\s*[+−]?\d+\.\d$/);
    // 좋은 수 갈래: 표에 세 번째 줄, 왼쪽 판을 좋은 수로 바꿔 볼 수 있다
    assert.match(await page.innerText('#cmpMoves thead'), /원래\s+이번\s+좋은 수/);
    await page.click('#cmpLeftPick [data-src="good"]');
    await page.waitForSelector('#cmpOrig g[data-square="f3"][data-piece="bn"]');
    await page.screenshot({ path: path.join(SHOTS, 'app-compare.png') });
    await page.click('#cmpLeftPick [data-src="orig"]');
    await page.waitForSelector('#cmpOrig g[data-square="d7"][data-piece="bq"]');
    await page.click('#nextStep');
    assert.strictEqual(await page.textContent('#stepInfo'), '15.');
    await page.click('#tabs [data-view="good"]');
    await page.waitForSelector('#board:not([hidden])');
    // 찾았으니 '둔 수' 탭은 없다
    assert.ok(await page.isHidden('#tabs [data-view="bad"]'));
    assert.ok(await page.isHidden('#history'));
    // 빈 줄이 있어도 칸이 정사각형
    const sizes = await page.$$eval('#board rect[data-square]', (els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    assert.ok(Math.max(...sizes) - Math.min(...sizes) <= 1, `칸 높이가 다름: ${Math.min(...sizes)}~${Math.max(...sizes)}`);

    await page.click('#homeBtn');
    await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('/'));
    const stats = (await page.textContent('#stats')).replace(/\s+/g, ' ');
    console.log('홈:', stats);
    assert.match(stats, /1\/1\s*찾은 장면/);
    assert.match(stats, /[01]\/1\s*원래보다 나은 판/);
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
