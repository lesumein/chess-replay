// 앱을 닫아 둔 동안 안드로이드 작업(AnalyzeWorker)이 화면 없는 WebView로 이 페이지를 연다.
// 정해진 시간 동안 새 게임을 분석해 장면을 쌓고, 끝나면 네이티브 쪽에 알린다.
import { Engine } from './engine.js';
import { analyzeMore } from './library.js';
import * as store from './store.js';

const BUDGET = 8 * 60 * 1000; // 안드로이드 작업은 10분 안에 끝나야 한다
const params = new URLSearchParams(location.search);

function report(text) {
  window.AndroidBackground?.done(text);
  document.title = text; // 테스트에서 읽는다
}

(async () => {
  let user = '';
  try { user = localStorage.getItem('user') || ''; } catch {}
  if (!user) return report('no-user');
  const deadline = Date.now() + (Number(params.get('budget')) || BUDGET);
  const engine = new Engine('stockfish/stockfish-18-lite-single.js');
  let scenes = 0;
  try {
    await engine.init();
    const how = await analyzeMore(engine, user, {
      onScene: () => { scenes++; },
      shouldStop: () => Date.now() > deadline,
    });
    const last = (await store.get('meta', 'background')) ?? { scenes: 0 };
    // 홈에서 "닫아 둔 동안 N개 만들었어요"를 보여 주려고, 사용자가 보기 전까지 더해 둔다
    await store.put('meta', { at: Date.now(), scenes: last.scenes + scenes }, 'background');
    report(`${how}:${scenes}`);
  } catch (err) {
    report(`error:${err.message}`);
  } finally {
    engine.terminate();
  }
})();
