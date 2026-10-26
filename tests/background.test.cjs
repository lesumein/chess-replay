// 앱을 닫아 둔 동안 안드로이드 작업이 여는 background.html을 브라우저에서 흉내 낸다.
// 아이디만 저장된 상태에서 열면 게임을 분석해 장면을 쌓고 'done:N'을 알린다.
//   node tests/background.test.cjs
const assert = require('assert');
const { chromium, devices } = require('playwright');
const { serve, fakeChessCom } = require('./helpers.cjs');

(async () => {
  const server = await serve();
  const browser = await chromium.launch();
  const context = await browser.newContext({ ...devices['Pixel 7'] });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await fakeChessCom(page);
  const base = `http://localhost:${server.address().port}`;

  try {
    // 아이디가 없으면 아무것도 하지 않는다
    await page.goto(`${base}/background.html`);
    await page.waitForFunction(() => document.title !== '분석');
    assert.strictEqual(await page.title(), 'no-user');

    await page.evaluate(() => localStorage.setItem('user', 'lesum_ein'));
    await page.goto(`${base}/background.html`);
    await page.waitForFunction(() => document.title !== '분석', null, { timeout: 120_000 });
    const title = await page.title();
    console.log('결과:', title);
    assert.match(title, /^done:\d+$/);
    const made = Number(title.split(':')[1]);
    assert.ok(made >= 3, `장면이 너무 적음: ${made}`);

    // 다음에 앱을 열면 "닫아 둔 동안 N개"가 보인다
    await page.goto(`${base}/index.html?nosw`);
    await page.waitForSelector('#play:not([hidden])', { timeout: 60_000 }); // 장면이 있으니 바로 두기
    await page.click('#quitBtn');
    await page.waitForSelector('#closedNote:not([hidden])');
    const note = await page.textContent('#closedNote');
    console.log('홈:', note);
    assert.strictEqual(note, `앱을 닫아 둔 동안 장면 ${made}개를 만들어 뒀어요`);

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
