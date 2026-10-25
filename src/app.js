import { Engine } from './engine.js';
import { Board } from './board.js';
import { playScene } from './play.js';
import { analyzeMore } from './library.js';
import { material } from './material.js';
import * as store from './store.js';

const ENGINE_URL = 'stockfish/stockfish-18-lite-single.js';
const FAKE_EVERY = 4; // 장면 네 개에 하나꼴로 가짜
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const NATIVE = !!window.Capacitor?.isNativePlatform?.();
const TIME_CLASS = { bullet: '불릿', blitz: '블리츠', rapid: '래피드', daily: '데일리' };

let user = '';
try { user = localStorage.getItem('user') || ''; } catch {}

let playEngine = null;
let bgEngine = null;
let bgRunning = null;
let board = null;
let session = null; // 지금 두는 장면을 멈출 AbortController
let installPrompt = null;
let madeWhileClosed = 0; // 앱을 닫아 둔 동안 백그라운드 작업이 만든 장면 수

function show(view) {
  for (const v of ['setup', 'home', 'play']) $(v).hidden = v !== view;
  window.scrollTo(0, 0);
}

function setNote(text, busy = false) {
  $('note').textContent = text;
  $('spinner').hidden = !busy;
}

// ---- 백그라운드: 앱이 열려 있는 동안 새 게임을 계속 분석해 쌓는다 ----
// 폰 웹앱은 닫히면 계산이 멈추므로, 열려 있는 시간을 최대한 쓴다.
let waitingForScene = false; // 장면이 없어 홈에서 기다리는 중이면 첫 장면이 생기자마자 시작

const visible = () => document.visibilityState === 'visible'
  ? Promise.resolve()
  : new Promise((r) => document.addEventListener('visibilitychange', function on() {
    if (document.visibilityState === 'visible') {
      document.removeEventListener('visibilitychange', on);
      r();
    }
  }));

function runBackground() {
  bgRunning ??= (async () => {
    try {
      setNote('게임을 가져오는 중…', true);
      bgEngine ??= new Engine(ENGINE_URL);
      await bgEngine.init();
      await analyzeMore(bgEngine, user, {
        beforeEach: visible,
        onGame: (g) => setNote(`${dateLabel(g.endTime)} 게임을 분석하는 중…`, true),
        onGameDone: renderHome,
        onScene: onNewScene,
      });
      setNote('끝난 게임을 모두 분석했어요. 새 게임을 두면 다시 쌓여요.');
    } catch (err) {
      setNote(err.message);
      throw err;
    } finally {
      bgRunning = null;
    }
  })();
  return bgRunning;
}

function onNewScene() {
  if (waitingForScene && !$('home').hidden) {
    waitingForScene = false;
    startScene();
  } else {
    renderHome();
  }
}

// ---- 다음 장면 고르기 ----
async function nextScene() {
  const [scenes, results] = await Promise.all([store.getAll('scenes'), store.getAll('results')]);
  if (params.has('scene')) {
    const s = scenes.find((x) => x.ply === Number(params.get('scene')));
    if (s) return s;
  }
  const lastResult = new Map();
  for (const r of results) lastResult.set(r.sceneId, r);
  const fresh = scenes.filter((s) => !lastResult.has(s.id));
  const real = fresh.filter((s) => !s.fake).sort((a, b) => b.loss - a.loss);
  const fakes = fresh.filter((s) => s.fake);
  if (fakes.length && (results.length % FAKE_EVERY === FAKE_EVERY - 1 || !real.length)) return fakes[0];
  if (real.length) return real[0];
  // 새 장면이 없으면 못 찾았던 장면을 오래된 것부터 다시
  const retry = scenes.filter((s) => !s.fake && lastResult.get(s.id)?.outcome !== 'found');
  retry.sort((a, b) => lastResult.get(a.id).at - lastResult.get(b.id).at);
  return retry[0] ?? null;
}

// ---- 홈 ----
function dateLabel(sec) {
  return new Date(sec * 1000).toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
}

function ago(ms) {
  const days = Math.floor((Date.now() - ms) / 86400e3);
  return days <= 0 ? '오늘' : days === 1 ? '어제' : `${days}일 전`;
}

const OUTCOME = {
  found: { mark: '✅', title: (s) => (s.fake ? '잘 넘겼어요' : s.kind === 'blunder' ? '피했어요' : '찾았어요'), good: true },
  missed: { mark: '💡', title: (s) => (s.fake ? '흔들렸어요' : s.kind === 'blunder' ? '걸렸어요' : '놓쳤어요'), good: false },
  timeout: { mark: '⏱', title: () => '시간이 다 됐어요', good: false },
  deviated: { mark: '↪', title: () => '다른 길로 갔어요', good: false },
};

async function renderHome() {
  if ($('home').hidden) return;
  const [scenes, results, days, games] = await Promise.all([
    store.getAll('scenes'), store.getAll('results'), store.get('meta', 'days'), store.getAll('games'),
  ]);
  const played = new Set(results.map((r) => r.sceneId));
  const judged = results.filter((r) => !r.fake && (r.outcome === 'found' || r.outcome === 'missed' || r.outcome === 'timeout'));
  const found = judged.filter((r) => r.outcome === 'found').length;
  const since = Date.now() - 14 * 86400e3;
  const recentDays = (days ?? []).filter((d) => new Date(d).getTime() >= since).length;
  const analyzed = games.filter((g) => g.status === 'done').length;
  const remaining = scenes.filter((s) => !played.has(s.id)).length;

  $('remaining').innerHTML = `${remaining}<small>장면 준비됨</small>`;
  $('closedNote').hidden = !madeWhileClosed;
  $('closedNote').textContent = `앱을 닫아 둔 동안 ${madeWhileClosed}개 만들어 뒀어요`;
  $('stats').innerHTML = `
    <div><b>${judged.length ? `${found}/${judged.length}` : '–'}</b><span>찾은 장면</span></div>
    <div><b>${analyzed}</b><span>분석한 게임</span></div>
    <div><b>${recentDays}</b><span>최근 2주 연 날</span></div>`;
  const next = await nextScene();
  $('playBtn').disabled = !next;
  $('playBtn').textContent = next ? (remaining ? '두기' : '못 찾은 장면 다시 두기') : '장면을 만드는 중…';

  const byId = new Map(scenes.map((s) => [s.id, s]));
  const recent = results.slice(-5).reverse().map((r) => {
    const s = byId.get(r.sceneId);
    if (!s) return '';
    const o = OUTCOME[r.outcome] ?? OUTCOME.deviated;
    const what = s.fake ? '아무것도 없던 장면' : `${s.moveNo}수 ${s.kind === 'blunder' ? '큰 실수' : '놓친 기회'}`;
    return `<li><span class="mark">${o.mark}</span><span>${esc(what)} · ${esc(o.title(s))}</span><span class="when">${ago(r.at)}</span></li>`;
  }).join('');
  $('recent').innerHTML = recent;
  $('recentBox').hidden = !recent;
}

async function goHome() {
  session?.abort();
  board?.destroy();
  board = null;
  show('home');
  await renderHome();
}

// ---- 두기 ----
function setClock(ms) {
  const s = Math.ceil(ms / 1000);
  $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  $('clock').classList.toggle('low', s <= 10);
}

function setTurn(who) {
  $('clock').classList.toggle('on', who === 'me');
  $('thinking').hidden = who !== 'opp';
}

// 이름 아래에 잡은 기물과 점수 우위(+N)
function showMaterial(fen, meColor, oppColor) {
  const m = material(fen);
  const render = ({ took, plus }, takenColor) => {
    let prev = null;
    const icons = took.map((t) => {
      const gap = prev && prev !== t ? ' class="gap"' : '';
      prev = t;
      return `<svg viewBox="0 0 40 40"${gap}><use href="#${takenColor}${t}"/></svg>`;
    }).join('');
    return icons + (plus ? `<b>+${plus}</b>` : '');
  };
  $('meMaterial').innerHTML = render(m[meColor], oppColor);
  $('oppMaterial').innerHTML = render(m[oppColor], meColor);
}

async function startScene() {
  session?.abort();
  const mine = (session = new AbortController());
  const scene = await nextScene();
  if (!scene) return goHome();
  show('play');
  $('result').hidden = true;
  const meColor = scene.side ? 'b' : 'w';
  const oppColor = scene.side ? 'w' : 'b';
  $('opp').innerHTML = `${esc(scene.opp.name)}${scene.opp.rating ? `<span class="rating">${scene.opp.rating}</span>` : ''}`;
  $('oppAvatar').className = `avatar ${oppColor}`;
  $('oppAvatar').textContent = scene.opp.name[0]?.toUpperCase() ?? '';
  $('me').textContent = scene.me.name;
  $('meAvatar').className = `avatar ${meColor}`;
  $('meAvatar').textContent = scene.me.name[0]?.toUpperCase() ?? '';
  $('gameInfo').textContent = `${dateLabel(scene.endTime)} · ${TIME_CLASS[scene.timeClass] ?? scene.timeClass}`;
  setTurn(null);
  board?.destroy();
  board = new Board($('board'), { bottom: meColor, onMove: () => {} });
  board.onPosition = (fen) => showMaterial(fen, meColor, oppColor);
  playEngine ??= new Engine(ENGINE_URL);
  await playEngine.init();
  $('history').hidden = false;
  const result = await playScene(scene, playEngine, { board, clock: setClock, turn: setTurn, history: setHistory }, {
    botDelay: params.has('fast') ? 0 : 600,
    signal: mine.signal,
  });
  if (!result) return;
  $('history').hidden = true;
  const { text, review, end, ...record } = result;
  await store.add('results', record);
  showResult(scene, result);
}

function showResult(scene, result) {
  const o = OUTCOME[result.outcome] ?? OUTCOME.deviated;
  $('resultBadge').textContent = o.mark;
  $('resultBadge').className = `badge ${o.good ? 'good' : 'bad'}`;
  $('resultTitle').textContent = o.title(scene);
  $('resultText').textContent = result.text;
  const times = [];
  if (result.ms != null) times.push(`이 수에 ${Math.round(result.ms / 1000)}초`);
  if (scene.origSpent != null) times.push(`원래 게임에선 ${Math.round(scene.origSpent)}초`);
  $('resultTime').textContent = times.join(' · ');
  $('resultTime').hidden = !times.length;

  showReview(scene, result.review, result.end);
  $('resultLink').href = `${scene.gameUrl}?move=${scene.ply + 1}`;
  $('result').hidden = false;
  $('result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// 결과 아래에서 수순을 한 수씩 넘겨 본다.
// 좋은 수: 장면에서 좋은 수부터 이득이 확정될 때까지 / 둔 수: 내가(또는 원래 게임에서) 둔 수와 상대의 응수
// 끝난 판: 이번에 둔 수를 시작부터 끝까지
function showReview(scene, review, end) {
  const fromScene = { fen: review.fen, last: review.last, startPly: scene.ply };
  const views = {
    good: review.lines.good && { ...fromScene, steps: review.lines.good, arrow: 'good' },
    bad: review.lines.bad && { ...fromScene, steps: review.lines.bad, arrow: 'bad' },
    end: { ...end, arrow: null },
  };
  const tabs = [...$('tabs').querySelectorAll('button')];
  for (const t of tabs) t.hidden = !views[t.dataset.view];
  let view = views.good ? 'good' : views.bad ? 'bad' : 'end';
  let step = 0; // 0 = 시작 포지션, k = k수 둔 뒤

  const label = (startPly, k) => {
    const ply = startPly + k;
    const n = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) return `<i>${n}.</i>`;
    return k === 0 ? `<i>${n}...</i>` : '';
  };

  function draw() {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
    const v = views[view];
    const line = v.steps;
    const fen = step ? line[step - 1].fen : v.fen;
    const last = step ? line[step - 1].uci : v.last;
    const next = line[step];
    // 좋은 수·둔 수는 다음에 둘 수를 화살표로
    board.set(fen, [], last, v.arrow && next ? [{ uci: next.uci, kind: v.arrow }] : []);
    $('lineText').innerHTML = line
      .map((m, k) => `${label(v.startPly, k)}<span class="${k < step - 1 ? 'done' : k === step - 1 ? 'now' : ''}" data-step="${k + 1}">${esc(m.san)}</span>`)
      .join(' ');
    $('stepInfo').textContent = `${step} / ${line.length}`;
    $('prevStep').disabled = step === 0;
    $('nextStep').disabled = step === line.length;
  }

  for (const t of tabs) {
    t.onclick = () => {
      view = t.dataset.view;
      // 끝난 판은 끝 모습부터, 나머지는 장면부터
      step = view === 'end' ? views.end.steps.length : 0;
      draw();
    };
  }
  $('prevStep').onclick = () => { step = Math.max(0, step - 1); draw(); };
  $('nextStep').onclick = () => { step = Math.min(views[view].steps.length, step + 1); draw(); };
  $('lineText').onclick = (e) => {
    const k = e.target.closest('[data-step]')?.dataset.step;
    if (k) { step = Number(k); draw(); }
  };
  draw();
}

// 두는 동안 지나간 수 되돌려 보기. 새 수가 오면 지금 판으로 돌아온다.
let past = [];
let viewing = null; // null = 지금 판, 숫자 = history에서 보고 있는 칸

function setHistory(h) {
  past = h;
  viewing = null;
  updateHistoryButtons();
}

function viewHistory(i) {
  if (i >= past.length - 1) {
    viewing = null;
    board.backToLive();
  } else {
    viewing = Math.max(0, i);
    board.peek(past[viewing].fen, past[viewing].last);
  }
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const at = viewing ?? past.length - 1;
  $('histPrev').disabled = at <= 0;
  $('histNext').disabled = viewing === null;
  $('history').classList.toggle('peeking', viewing !== null);
}

// ---- 설정 ----
async function openSettings() {
  $('userEdit').value = user;
  $('installBox').hidden = !installPrompt;
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  $('storageInfo').textContent = [
    est ? `이 폰에 저장된 크기 약 ${Math.max(1, Math.round(est.usage / 1e6))}MB` : '',
    persisted ? '브라우저가 지우지 않도록 보관 중' : '',
  ].filter(Boolean).join(' · ');
  $('settings').showModal();
}

// 분석 중이던 엔진을 버린다(이전 아이디의 장면이 새로 저장되지 않게).
function stopBackground() {
  bgEngine?.terminate();
  bgEngine = null;
  bgRunning = null;
}

async function switchUser(name) {
  if (name.toLowerCase() !== user.toLowerCase()) {
    session?.abort();
    stopBackground();
    await store.clearAll();
  }
  user = name;
  try { localStorage.setItem('user', user); } catch {}
  // 브라우저가 공간이 모자랄 때 기록을 지우지 않도록 요청
  navigator.storage?.persist?.().catch(() => {});
  await recordDay();
  waitingForScene = true;
  await goHome();
  runBackground().catch(() => {});
}

$('settingsBtn').addEventListener('click', openSettings);
$('closeSettings').addEventListener('click', () => $('settings').close());
$('settings').addEventListener('click', (e) => { if (e.target === $('settings')) $('settings').close(); });
$('userForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('userEdit').value.trim();
  if (!name) return;
  $('settings').close();
  await switchUser(name);
});
$('resetBtn').addEventListener('click', async () => {
  if (!confirm('이 폰에 쌓인 장면과 기록을 모두 지울까요?')) return;
  session?.abort();
  stopBackground();
  await store.clearAll();
  try { localStorage.removeItem('user'); } catch {}
  user = '';
  $('settings').close();
  show('setup');
});
$('installBtn').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice.catch(() => {});
  installPrompt = null;
  $('installBox').hidden = true;
});
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  installPrompt = e;
});

// ---- 시작 ----
async function recordDay() {
  const today = new Date().toISOString().slice(0, 10);
  const days = (await store.get('meta', 'days')) ?? [];
  if (!days.includes(today)) await store.put('meta', [...days, today], 'days');
}

$('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('user').value.trim();
  if (name) await switchUser(name);
});

$('playBtn').addEventListener('click', startScene);
$('nextBtn').addEventListener('click', startScene);
$('homeBtn').addEventListener('click', goHome);
$('quitBtn').addEventListener('click', goHome);
$('histPrev').addEventListener('click', () => viewHistory((viewing ?? past.length - 1) - 1));
$('histNext').addEventListener('click', () => viewHistory((viewing ?? past.length - 1) + 1));

if ('serviceWorker' in navigator && !params.has('nosw') && !NATIVE) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

(async () => {
  if (!user) return show('setup');
  await recordDay();
  const bg = await store.get('meta', 'background');
  if (bg?.scenes) {
    madeWhileClosed = bg.scenes;
    await store.put('meta', { ...bg, scenes: 0 }, 'background');
  }
  // 이미 만들어 둔 장면이 있으면 바로 두기, 그동안 뒤에서 새 게임을 쌓는다.
  const scene = await nextScene();
  if (scene) startScene();
  else {
    waitingForScene = true;
    await goHome();
  }
  runBackground().catch(() => {});
})();
