// Chess.com '공유하기'로 받은 게임을 바로 복기한다(설치한 웹 앱은 주소의 text로 받는다).
//   node tests/share.test.cjs
const fs = require('fs');
const path = require('path');
const assert = require('assert');
const { chromium, devices } = require('playwright');
const { serve, fakeChessCom } = require('./helpers.cjs');

const GAME = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/games-2026-10.json'))).games[0];

(async () => {
  const server = await serve();
  const browser = await chromium.launch();
  const base = `http://localhost:${server.address().port}/index.html?nosw&fast`;
  const errors = [];

  // Lichess 공개 API 대신: 같은 기보를 Lichess 형식(Site, Link 없음)으로
  const LICHESS_PGN = GAME.pgn.replace(/\[Link "[^"]*"\]\n/, '').replace('[Site "Chess.com"]', '[Site "https://lichess.org/AbCd1234"]');

  async function fresh() {
    const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await fakeChessCom(page);
    await page.route('https://lichess.org/game/export/**', (route) => {
      const ok = route.request().url().includes('/AbCd1234');
      route.fulfill({ status: ok ? 200 : 404, contentType: 'application/x-chess-pgn', headers: { 'access-control-allow-origin': '*' }, body: ok ? LICHESS_PGN : '' });
    });
    return page;
  }

  try {
    // 1) 링크 공유: 그 게임을 분석해 손해가 가장 큰 장면부터 바로 시작
    let page = await fresh();
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('user', 'lesum_ein'));
    const shareText = `Check out this #chess game: ${GAME.url}`;
    await page.goto(`${base}&text=${encodeURIComponent(shareText)}`);
    await page.waitForSelector('#play:not([hidden])', { timeout: 120_000 });
    assert.ok(!page.url().includes('text='), '공유 글이 주소에 남음');
    const scenes = await page.evaluate(async () => (await import('./src/store.js')).getAll('scenes'));
    const top = scenes.filter((s) => !s.fake).sort((a, b) => b.loss - a.loss)[0];
    console.log('링크 → 장면', `${top.moveNo}수 ${top.playedSan}→${top.bestSan}`);
    await page.close();

    // 2) PGN 공유(아이디를 넣기 전): 아이디를 넣으면 바로 그 게임
    page = await fresh();
    await page.goto(`${base}&text=${encodeURIComponent(GAME.pgn)}`);
    await page.waitForSelector('#setup:not([hidden])');
    await page.fill('#user', 'lesum_ein');
    await page.click('#setupForm button');
    await page.waitForSelector('#play:not([hidden])', { timeout: 120_000 });
    console.log('PGN → 두기 시작');
    await page.close();

    // 3) 남의 게임 PGN: 어느 쪽으로 둘지 고르면 그쪽 시점으로
    page = await fresh();
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('user', 'someone_else'));
    await page.goto(`${base}&text=${encodeURIComponent(GAME.pgn)}`);
    await page.waitForSelector('#shareNote [data-side="0"]', { timeout: 60_000 });
    const pick = (await page.innerText('#shareNote')).replace(/\s+/g, ' ');
    console.log('남의 게임 →', pick);
    assert.match(pick, /백 · opponent 677 장면 \d+개 흑 · lesum_ein 608 장면 \d+개/);
    await page.click('#shareNote [data-side="0"]');
    await page.waitForSelector('#play:not([hidden])', { timeout: 120_000 });
    const a1 = await page.locator('#board rect[data-square="a1"]').boundingBox();
    const h8 = await page.locator('#board rect[data-square="h8"]').boundingBox();
    assert.ok(a1.y > h8.y, '백으로 골랐는데 백이 아래가 아님');
    console.log('백 쪽으로 두기 시작');
    await page.close();

    // 4) 남의 게임 링크: 찾을 수 없으니 PGN으로 공유하라는 안내
    page = await fresh();
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('user', 'someone_else'));
    await page.goto(`${base}&text=${encodeURIComponent('https://www.chess.com/game/live/123456789')}`);
    await page.waitForFunction(() => document.querySelector('#shareNote').textContent.includes('PGN'));
    console.log('남의 링크 →', await page.textContent('#shareNote'));
    await page.close();

    // 5) Lichess 링크(남의 게임, /black로 공유) → 쪽 고르기에서 '내 다른 아이디' 표시 → 다음부터 바로
    page = await fresh();
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('user', 'someone_else'));
    await page.goto(`${base}&text=${encodeURIComponent('https://lichess.org/AbCd1234/black')}`);
    await page.waitForSelector('#shareNote [data-side="1"]', { timeout: 60_000 });
    assert.ok(await page.$('#shareNote [data-side="0"].quiet-alt'), '링크가 흑이면 흑을 앞세운다');
    await page.check('#mineCheck');
    await page.click('#shareNote [data-side="1"]');
    await page.waitForSelector('#play:not([hidden])', { timeout: 120_000 });
    assert.deepStrictEqual(await page.evaluate(() => JSON.parse(localStorage.getItem('aliases'))), ['lesum_ein']);
    console.log('Lichess 링크 → 흑으로 두기, 내 다른 아이디 저장');
    await page.click('#quitBtn');
    // 같은 이름이 든 기보(PGN)는 이제 묻지 않고 바로
    await page.goto(`${base}&text=${encodeURIComponent(GAME.pgn.replace('[Event "Live Chess"]', '[Event "Again"]').replace(/\[Link "[^"]*"\]/, '[Link "https://www.chess.com/game/live/1"]'))}`);
    await page.waitForSelector('#play:not([hidden])', { timeout: 120_000 });
    console.log('내 다른 아이디 → 바로 두기');
    // 없는 Lichess 게임
    await page.goto(`${base}&text=${encodeURIComponent('https://lichess.org/zzzzzzzz')}`);
    await page.waitForFunction(() => document.querySelector('#shareNote').textContent.includes('Lichess에서 그 게임을 찾지 못했어요'));
    await page.close();

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
