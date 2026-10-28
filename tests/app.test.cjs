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
    // 세트의 앞 네 장면은 이미 둔 것으로 채워 둔다(이 장면으로 세트가 끝나게)
    await page.evaluate(async () => {
      const st = await import('./src/store.js');
      const ids = (await st.getAll('scenes')).filter((x) => x.ply !== 27).map((x) => x.id);
      const items = [0, 1, 2, 3].map((i) => ({ sceneId: ids[i] ?? `none#${i}`, outcome: i % 2 ? 'found' : 'missed', fake: false, gain: i * 80 - 100 }));
      await st.put('meta', { at: Date.now(), items }, 'set');
    });
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
    // 장면 뒤로는 아무 수나 두므로 판정 글자 모양만 본다
    assert.match(compare, /^원래 대비\s+[+−]?\d+\.\d\s+원래(보다 잘 뒀어요|보다 나빠졌어요|와 비슷해요)$/);
    // 장면 포지션으로 돌아가 좋은 수를 화살표로 보여 준다
    await page.waitForSelector('#board .arrow-success');
    assert.ok(await page.$('#board g[data-square="e5"][data-piece="bn"]'), '장면 포지션이 아님');
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(SHOTS, 'app-result.png') });
    // 판정 시트에서 복기를 열면 시트는 내려가고 수순과 ◀ ▶ 바가 나온다
    await page.click('#reviewBtn');
    await page.waitForSelector('#review:not([hidden])');
    assert.ok(await page.isHidden('#result'));
    // 복기를 열면 판 전체와 수순이 한 화면에 같이 보인다
    await page.waitForTimeout(700);
    const vh0 = page.viewportSize().height;
    const boardBox = await page.locator('#board').boundingBox();
    const lineBox = await page.locator('#lineText').boundingBox();
    const barTop = (await page.locator('#stepper').boundingBox()).y;
    assert.ok(boardBox.y >= -1 && boardBox.y + boardBox.height <= vh0, `판이 잘림: ${boardBox.y}`);
    assert.ok(lineBox.y < barTop, `수순이 안 보임: ${lineBox.y} / ${barTop}`);
    // 더 내려도 판은 위에 붙어 있다
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(300);
    assert.ok(Math.abs((await page.locator('#board').boundingBox()).y) <= 1, '내려도 판이 위에 붙어 있어야 함');
    await page.mouse.wheel(0, -2000);
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
    // ◀를 누르고 있으면 반복해서 처음까지 간다(점점 빨라짐)
    const prevBox = await page.locator('#prevStep').boundingBox();
    await page.mouse.move(prevBox.x + prevBox.width / 2, prevBox.y + prevBox.height / 2);
    await page.mouse.down();
    await page.waitForFunction(() => document.querySelector('#stepCount').textContent.startsWith('0 / '), null, { timeout: 4000 });
    await page.mouse.up();
    assert.ok(await page.isDisabled('#prevStep'));
    // 한 번 누르면 한 칸만
    await page.click('#nextStep');
    assert.ok((await page.textContent('#stepCount')).startsWith('1 / '));
    for (let i = 1; i < at + 1; i++) await page.click('#nextStep');
    await page.waitForSelector('#board g[data-square="f3"][data-piece="bn"]');
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
    assert.match(split, /^14\.\.\. Qd7\s*[+−]?\d+\.\d 최선 Nxf3\+ Nxf3\+\s*[+−]?\d+\.\d Nxf3\+\s*[+−]?\d+\.\d$/);
    // 판 위 숫자는 여기까지 잃은 점수의 합. 마지막 수에서 둘의 차가 결과의 '원래 대비'와 같다
    const headline = (await page.textContent('#reviewGain')).replace('원래 대비 ', '');
    const total = Number((await page.textContent('#stepCount')).split(' / ')[1]);
    for (let i = 0; i < total; i++) if (!(await page.isDisabled('#nextStep'))) await page.click('#nextStep');
    const sum = await page.textContent('#cmpSum b');
    console.log('끝 합계:', sum, '결과:', headline, '·', await page.textContent('#cmpOrigScore'), await page.textContent('#cmpMineScore'));
    assert.strictEqual(sum, headline);
    // 좋은 수 갈래도 원래 대비 숫자가 있다(장면에서 원래가 잃은 만큼 플러스)
    assert.match(await page.innerText('#cmpSum'), /좋은 수 \+\d+\.\d/);
    await page.click('#tabs [data-view="cmp"]');
    // 좋은 수 갈래: 표에 세 번째 줄, 왼쪽 판을 좋은 수로 바꿔 볼 수 있다
    assert.match(await page.innerText('#cmpMoves thead'), /원래\s+이번\s+좋은 수/);
    await page.click('#cmpLeftPick [data-src="good"]');
    await page.waitForSelector('#cmpOrig g[data-square="f3"][data-piece="bn"]');
    await page.screenshot({ path: path.join(SHOTS, 'app-compare.png') });
    // 최선 갈래: 처음부터 엔진 최선. 고르면 표의 세 번째 줄도 최선으로
    await page.click('#cmpLeftPick [data-src="best"]');
    assert.match(await page.innerText('#cmpMoves thead'), /원래\s+이번\s+최선/);
    assert.match(await page.innerText('#cmpSum'), /최선 \+\d+\.\d/);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(SHOTS, 'app-best.png') });
    console.log('최선 갈래:', (await page.innerText('#cmpSum')).replace(/\s+/g, ' '));
    // 원래 수가 크게 잃은 자리(14...Qd7)에는 최선 수가 적혀 있다
    assert.match(await page.innerText('#cmpMoves tr.split'), /최선 Nxf3\+/);
    await page.click('#cmpLeftPick [data-src="good"]');
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

    await page.screenshot({ path: path.join(SHOTS, 'app-review.png') });
    // 다섯 번째 장면이었으니 세트 결과로
    assert.strictEqual(await page.textContent('#reviewNextBtn'), '세트 결과 보기');
    await page.click('#reviewNextBtn');
    await page.waitForSelector('#setDone:not([hidden])');
    console.log('세트:', (await page.innerText('#setDone')).replace(/\s+/g, ' '));
    assert.match(await page.textContent('#doneSub'), /^5장면 모두 실제로 놓쳤던 순간이었어요$/);
    // 버튼은 화면 아래에 붙어 있다
    const again = await page.locator('#againBtn').boundingBox();
    assert.ok(again.y + again.height <= page.viewportSize().height, '한 세트 더 버튼이 화면 밖');
    assert.match(await page.textContent('#doneCountLabel'), /잘 둔 장면/);
    await page.waitForTimeout(900);
    await page.screenshot({ path: path.join(SHOTS, 'app-setdone.png'), fullPage: true });
    await page.click('#doneHomeBtn');
    await page.waitForFunction(() => document.querySelector('#setEyebrow').textContent.includes('오늘 1세트 완료'));
    await page.waitForFunction(() => document.querySelector('#stats').textContent.includes('/'));
    const stats = (await page.textContent('#stats')).replace(/\s+/g, ' ');
    console.log('홈:', stats);
    assert.match(stats, /1\/1\s*찾은 장면/);
    assert.match(stats, /[01]\/1\s*원래보다 나은 판/);
    assert.match(await page.textContent('#recent'), /14수 놓친 기회 · 찾았어요/);
    assert.match(stats, /1\s*일\s*연속/);
    await page.screenshot({ path: path.join(SHOTS, 'app-home.png') });
    // 자유 모드: 세트 기록지 없이 바로 두기, 두는 화면 위엔 세트 칸 대신 '자유 두기'
    await page.click('#modePick [data-mode="free"]');
    await page.waitForFunction(() => document.querySelector('#setTitle').textContent === '자유롭게 두기');
    assert.ok(await page.isHidden('#setRows'));
    await page.waitForFunction(() => !document.querySelector('#playBtn').disabled);
    await page.click('#playBtn');
    await page.waitForSelector('#play:not([hidden])');
    await page.waitForFunction(() => document.querySelector('#setProgress').textContent === '자유 두기');
    await page.click('#quitBtn');
    await page.click('#modePick [data-mode="set"]');
    await page.waitForFunction(() => !document.querySelector('#setRows').hidden);

    // 앱 버전이 안드로이드 versionName과 같다
    const gradle = require('fs').readFileSync(path.join(__dirname, '../android/app/build.gradle'), 'utf8');
    const app = require('fs').readFileSync(path.join(__dirname, '../src/app.js'), 'utf8');
    assert.strictEqual(/VERSION = '([^']+)'/.exec(app)[1], /versionName "([^"]+)"/.exec(gradle)[1]);
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
