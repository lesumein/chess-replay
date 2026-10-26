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

  async function fresh() {
    const page = await (await browser.newContext({ ...devices['Pixel 7'] })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    await fakeChessCom(page);
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

    // 3) 남의 게임: 안내만
    page = await fresh();
    await page.goto(base);
    await page.evaluate(() => localStorage.setItem('user', 'someone_else'));
    await page.goto(`${base}&text=${encodeURIComponent(GAME.pgn)}`);
    await page.waitForFunction(() => document.querySelector('#shareNote').textContent.includes('내가 둔 게임만'));
    console.log('남의 게임 →', await page.textContent('#shareNote'));
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
