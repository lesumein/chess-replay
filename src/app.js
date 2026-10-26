import { Engine } from './engine.js';
import { Board } from './board.js';
import { playScene, clockFor } from './play.js';
import { analyzeMore, analyzeGame, findSharedGame, isMine, sideCounts, backfillScenes, requeueOldScenes } from './library.js';
import { material } from './material.js';
import * as store from './store.js';

const ENGINE_URL = 'stockfish/stockfish-18-lite-single.js';
const FAKE_EVERY = 4; // 장면 네 개에 하나꼴로 가짜
const SET_SIZE = 5; // 장면 다섯 개가 한 세트
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
  for (const v of ['setup', 'home', 'play', 'setDone']) $(v).hidden = v !== view;
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
// 공유로 받은 게임이 있으면 그 게임의 장면부터(다 두면 원래 순서로)
let focusGame = null;
let replayScene = null; // 다음에 바로 둘 장면(한 번만)

async function nextScene() {
  const [scenes, results] = await Promise.all([store.getAll('scenes'), store.getAll('results')]);
  if (params.has('scene')) {
    const s = scenes.find((x) => x.ply === Number(params.get('scene')));
    if (s) return s;
  }
  const lastResult = new Map();
  for (const r of results) lastResult.set(r.sceneId, r);
  if (focusGame) {
    const own = scenes.filter((s) => s.gameUrl === focusGame && !s.fake && !lastResult.has(s.id)).sort((a, b) => b.loss - a.loss);
    if (own.length) return own[0];
    focusGame = null;
  }
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

const SAME = 100; // 원래 게임과 1폰 안 차이면 비슷한 것으로
// 원래 대비 얼마나 나았나(폰×100). 예전 결과는 끝 형세 차이로 저장돼 있다
const gain = (c) => (c.loss ? c.orig - c.now : c.now - c.orig);
// 폰 단위 부호 숫자(메이트로 바꾸지 않는다)
function signed(c) {
  const v = Math.round(c / 10) / 10;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(1);
}

function pawns(c) {
  if (c >= 1000) return '메이트';
  if (c <= -1000) return '메이트 당함';
  return (c > 0 ? '+' : c < 0 ? '−' : '') + Math.abs(c / 100).toFixed(1);
}

const RESULT = { win: '이긴 판', checkmated: '진 판', resigned: '진 판', timeout: '진 판', abandoned: '진 판', lose: '진 판' };

function gameLabel(scene) {
  const days = Math.floor((Date.now() / 1000 - scene.endTime) / 86400);
  const when = days <= 0 ? '오늘' : days === 1 ? '어제' : days < 14 ? `${days}일 전` : days < 60 ? `${Math.floor(days / 7)}주 전` : `${Math.floor(days / 30)}달 전`;
  const result = scene.me.result ? (RESULT[scene.me.result] ?? '비긴 판') : null;
  const tc = scene.tc ? ` ${scene.tc.base % 60 ? `${scene.tc.base}초` : scene.tc.base / 60}+${scene.tc.inc}` : '';
  return [when, (TIME_CLASS[scene.timeClass] ?? scene.timeClass) + tc, result].filter(Boolean).join(' · ');
}

const svg = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
const OUTCOME = {
  found: { icon: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'), tone: 'good', title: (s) => (s.fake ? '잘 넘겼어요' : s.kind === 'blunder' ? '피했어요' : '찾았어요'), good: true },
  missed: { icon: svg('<path d="M7 7l10 10M17 7 7 17"/>'), tone: 'bad', title: (s) => (s.fake ? '흔들렸어요' : s.kind === 'blunder' ? '걸렸어요' : '놓쳤어요'), good: false },
  timeout: { icon: svg('<circle cx="12" cy="13" r="7"/><path d="M12 10v3.5l2 1.5M10 3h4"/>'), tone: 'warn', title: () => '시간이 다 됐어요', good: false },
  deviated: { icon: svg('<path d="M6 20V10a4 4 0 0 1 4-4h8M15 3l3 3-3 3"/>'), tone: 'warn', title: () => '다른 길로 갔어요', good: false },
};
const outcomeOf = (o) => OUTCOME[o] ?? OUTCOME.deviated;
const sceneName = (s) => (s.fake ? '아무것도 없던 장면' : `${s.moveNo}수 ${s.kind === 'blunder' ? '큰 실수' : '놓친 기회'}`);
const gainClass = (d) => (d >= SAME ? 'up' : d <= -SAME ? 'down' : 'same');

// ---- 세트: 장면 다섯 개를 한 묶음으로 ----
// meta 'set' = { at, items: [{ sceneId, outcome, fake, gain }] }. 다섯 개가 차면 끝난 세트
async function currentSet() {
  return (await store.get('meta', 'set')) ?? null;
}
const setDone = (set) => !set || set.items.length >= SET_SIZE;

async function addToSet(scene, result) {
  let set = await currentSet();
  if (setDone(set)) set = { at: Date.now(), items: [] };
  set.items.push({ sceneId: scene.id, outcome: result.outcome, fake: !!scene.fake, gain: result.compare ? gain(result.compare) : null });
  await store.put('meta', set, 'set');
  return set;
}

// keep: 끝난 세트도 칸을 채워 보여 준다(마지막 장면의 결과 화면)
function dotsHtml(set, withNext, keep = false) {
  const items = !set || (setDone(set) && !keep) ? [] : set.items;
  return Array.from({ length: SET_SIZE }, (_, i) => {
    const it = items[i];
    const cls = it ? (outcomeOf(it.outcome).good ? 'good' : 'bad') : withNext && i === items.length ? 'now' : '';
    return `<i class="${cls}"></i>`;
  }).join('');
}

// 연속으로 둔 날 수(오늘 아직 안 뒀으면 어제부터 센다)
const localDay = (t) => { const d = new Date(t); return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`; };
function streakOf(results) {
  const days = new Set(results.map((r) => localDay(r.at)));
  const d = new Date();
  if (!days.has(localDay(d))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (days.has(localDay(d))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

async function renderHome() {
  if ($('home').hidden) return;
  const [scenes, results, games, set] = await Promise.all([
    store.getAll('scenes'), store.getAll('results'), store.getAll('games'), currentSet(),
  ]);
  const played = new Set(results.map((r) => r.sceneId));
  const judged = results.filter((r) => !r.fake && (r.outcome === 'found' || r.outcome === 'missed' || r.outcome === 'timeout'));
  const found = judged.filter((r) => r.outcome === 'found').length;
  const analyzed = games.filter((g) => g.status === 'done').length;
  const compared = results.filter((r) => r.compare);
  const better = compared.filter((r) => gain(r.compare) >= SAME).length;
  const remaining = scenes.filter((s) => !played.has(s.id)).length;
  const streak = streakOf(results);
  const today = localDay(Date.now());
  const setsToday = ((await store.get('meta', 'setLog')) ?? []).filter((x) => localDay(x.at) === today).length;

  // 세트 기보 용지: 둔 칸은 결과, 다음 칸은 표시, 나머지는 빈칸(앞으로 올 장면은 알려 주지 않는다)
  const going = !setDone(set) && set.items.length > 0;
  const date = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' });
  $('setEyebrow').textContent = setsToday ? `${date} · 오늘 ${setsToday}세트 완료` : date;
  $('setTitle').textContent = going ? `다섯 장면 중 ${set.items.length}개를 뒀어요` : setsToday ? '한 세트 더 둘까요?' : '오늘의 다섯 장면';
  const byScene = new Map(scenes.map((s) => [s.id, s]));
  const items = going ? set.items : [];
  $('setRows').innerHTML = Array.from({ length: SET_SIZE }, (_, i) => {
    const it = items[i];
    if (it) {
      const s = byScene.get(it.sceneId);
      const o = outcomeOf(it.outcome);
      return `<li class="done"><span class="no">${i + 1}</span><span class="what"><span class="badge sm ${o.tone}">${o.icon}</span><span>${s ? `${esc(sceneName(s))} · ` : ''}${esc(s ? o.title(s) : '')}</span></span>${it.gain != null ? `<span class="gain ${gainClass(it.gain)}">${signed(it.gain)}</span>` : '<span></span>'}</li>`;
    }
    const next = i === items.length;
    return `<li class="${next ? 'next' : ''}"><span class="no">${i + 1}</span><span class="what"><span class="${next ? '' : 'blank'}">${next ? '다음 장면' : '—'}</span></span><span></span></li>`;
  }).join('');
  $('streak').hidden = !streak;
  $('streak').textContent = `${streak}일 연속`;
  $('remaining').innerHTML = `준비된 장면 <b>${remaining}</b>`;
  $('analyzed').innerHTML = analyzed ? `분석한 게임 <b>${analyzed}</b>` : '';
  $('closedNote').hidden = !madeWhileClosed;
  $('closedNote').textContent = `앱을 닫아 둔 동안 장면 ${madeWhileClosed}개를 만들어 뒀어요`;
  $('stats').innerHTML = `
    <div><b>${judged.length ? `${found}/${judged.length}` : '–'}</b><span>찾은 장면</span></div>
    <div><b>${compared.length ? `${better}/${compared.length}` : '–'}</b><span>원래보다 나은 판</span></div>
    <div><b>${streak}<small>일</small></b><span>연속</span></div>`;
  const next = await nextScene();
  $('playBtn').disabled = !next;
  $('playBtn').textContent = !next ? '장면을 만드는 중…' : going ? '이어서 두기' : remaining ? '세트 시작' : '못 찾은 장면 다시 두기';

  // 최근 장면: 누르면 그 장면을 다시 둔다
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const seen = new Set();
  const recent = results.slice().reverse().filter((r) => byId.has(r.sceneId) && !seen.has(r.sceneId) && seen.add(r.sceneId)).slice(0, 6).map((r) => {
    const s = byId.get(r.sceneId);
    const o = outcomeOf(r.outcome);
    const d = r.compare ? gain(r.compare) : null;
    return `<li data-scene="${esc(s.id)}"><span class="badge sm ${o.tone}">${o.icon}</span>
      <span class="txt"><b>${esc(sceneName(s))} · ${esc(o.title(s))}</b><small>${esc(s.opp.name)} · ${esc(gameLabel(s))}</small></span>
      ${d != null ? `<span class="gain ${gainClass(d)}">${signed(d)}</span>` : ''}</li>`;
  }).join('');
  $('recent').innerHTML = recent;
  $('recentBox').hidden = !recent;
}

async function goHome() {
  if (updateReady) return location.reload();
  session?.abort();
  closeCompare();
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
  closeCompare();
  const mine = (session = new AbortController());
  const scene = replayScene ?? (await nextScene());
  replayScene = null;
  shareNote('');
  if (!scene) return goHome();
  show('play');
  $('result').hidden = true;
  $('review').hidden = true;
  const cur = await currentSet();
  const n = setDone(cur) ? 1 : cur.items.length + 1;
  $('setProgress').innerHTML = `<span class="dots sm">${dotsHtml(cur, true)}</span>세트 ${n}/${SET_SIZE}`;
  const meColor = scene.side ? 'b' : 'w';
  const oppColor = scene.side ? 'w' : 'b';
  $('opp').innerHTML = `${esc(scene.opp.name)}${scene.opp.rating ? `<span class="rating">${scene.opp.rating}</span>` : ''}`;
  $('oppAvatar').className = `avatar ${oppColor}`;
  $('oppAvatar').textContent = scene.opp.name[0]?.toUpperCase() ?? '';
  $('me').textContent = scene.me.name;
  $('meAvatar').className = `avatar ${meColor}`;
  $('meAvatar').textContent = scene.me.name[0]?.toUpperCase() ?? '';
  $('gameInfo').textContent = gameLabel(scene);
  setTurn(null);
  board?.destroy();
  board = new Board($('board'), { bottom: meColor, onMove: () => {} });
  board.onPosition = (fen) => showMaterial(fen, meColor, oppColor);
  playEngine ??= new Engine(ENGINE_URL);
  await playEngine.init();
  $('history').hidden = false;
  const mode = clockMode();
  const { inc } = clockFor(scene, mode);
  $('clockInc').textContent = inc ? `+${inc / 1000}초` : '';
  $('clockInc').hidden = !inc;
  let skip = false;
  $('board').onclick = () => { skip = true; };
  const result = await playScene(scene, playEngine, {
    board,
    clock: setClock,
    turn: setTurn,
    history: setHistory,
    preroll: (on) => { $('preroll').hidden = !on; skip = false; },
    skipPreroll: () => skip,
  }, {
    botDelay: params.has('fast') ? 0 : 600,
    signal: mine.signal,
    clockMode: mode,
  });
  if (!result) return;
  $('history').hidden = true;
  $('board').onclick = null;
  const { text, review, end, ...record } = result;
  await store.add('results', record);
  const set = await addToSet(scene, result);
  $('setProgress').innerHTML = `<span class="dots sm">${dotsHtml(set, false, true)}</span>세트 ${set.items.length}/${SET_SIZE}`;
  if (set.items.length === SET_SIZE) await logSet(set);
  showResult(scene, result, set);
}

function showResult(scene, result, set) {
  const o = outcomeOf(result.outcome);
  $('resultBadge').innerHTML = o.icon;
  $('resultBadge').className = `badge ${o.tone}`;
  $('resultTitle').textContent = o.title(scene);
  $('resultText').textContent = result.text;
  const times = [];
  if (result.ms != null) times.push(`이 수에 ${Math.round(result.ms / 1000)}초`);
  if (scene.origSpent != null) times.push(`원래 게임에선 ${Math.round(scene.origSpent)}초`);
  $('resultTime').textContent = times.join(' · ');
  $('resultTime').hidden = !times.length;

  // 원래 게임과 비교: 같은 구간 내 수 손실의 합을 원래 대비로
  const c = result.compare;
  const d = c ? gain(c) : null;
  if (c) {
    const verdict = d >= SAME ? '원래보다 잘 뒀어요' : d <= -SAME ? '원래보다 나빠졌어요' : '원래와 비슷해요';
    $('compare').innerHTML = `<span><span class="label">원래 대비</span><span class="gain ${gainClass(d)}">${signed(d)}</span></span><span class="verdict-text ${d >= SAME ? 'up' : d <= -SAME ? 'down' : ''}">${verdict}</span>`;
  }
  $('compare').hidden = !c;
  $('reviewBadge').innerHTML = o.icon;
  $('reviewBadge').className = `badge sm ${o.tone}`;
  $('reviewTitle').textContent = `${sceneName(scene)} · ${o.title(scene)}`;
  $('reviewGain').textContent = c ? `원래 대비 ${signed(d)}` : '';
  $('reviewGain').className = `gain ${c ? gainClass(d) : ''}`;

  const last = set.items.length === SET_SIZE;
  for (const b of [$('nextBtn'), $('reviewNextBtn')]) b.textContent = last ? '세트 결과 보기' : '다음 장면';
  showReview(scene, result.review, result.end, result.cmp);
  $('resultLink').href = `${scene.gameUrl}?move=${scene.ply + 1}`;
  $('play').classList.add('done');
  $('result').hidden = false;
}

// 판정 시트를 내리고 복기 패널을 연다
function openReview() {
  $('result').hidden = true;
  $('review').hidden = false;
  $('play').classList.remove('done');
  $('play').classList.add('reviewing');
  $('review').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function afterResult() {
  const set = await currentSet();
  if (set?.items.length === SET_SIZE) return showSetDone(set);
  startScene();
}

// ---- 세트 끝 ----
async function logSet(set) {
  const log = (await store.get('meta', 'setLog')) ?? [];
  log.push({ at: Date.now(), items: set.items });
  await store.put('meta', log, 'setLog');
}

async function showSetDone(set) {
  session?.abort();
  closeCompare();
  board?.destroy();
  board = null;
  const [scenes, results] = await Promise.all([store.getAll('scenes'), store.getAll('results')]);
  const byId = new Map(scenes.map((s) => [s.id, s]));
  const real = set.items.filter((x) => !x.fake);
  const found = real.filter((x) => x.outcome === 'found').length;
  const gains = set.items.filter((x) => x.gain != null);
  const total = gains.reduce((a, x) => a + x.gain, 0);
  show('setDone');
  $('doneCount').textContent = real.length ? `${found}/${real.length}` : `${set.items.filter((x) => x.outcome === 'found').length}/${set.items.length}`;
  $('doneCountLabel').textContent = real.length ? '찾은 장면' : '잘 넘긴 장면';
  const share = real.length ? found / real.length : 1;
  $('doneTitle').textContent = share >= 0.8 ? '날카로웠어요' : share >= 0.5 ? '좋은 세트였어요' : '다음엔 더 보일 거예요';
  const fakes = set.items.length - real.length;
  $('doneSub').textContent = fakes ? `${SET_SIZE}장면 중 ${fakes}개는 아무것도 없던 장면이었어요` : `${SET_SIZE}장면 모두 실제로 놓쳤던 순간이었어요`;
  const streak = streakOf(results);
  $('doneStats').innerHTML = `
    <div><b class="gain ${gains.length ? gainClass(total) : ''}">${gains.length ? signed(total) : '–'}</b><span>원래 대비 합계</span></div>
    <div><b>${gains.filter((x) => x.gain >= SAME).length}/${gains.length || '–'}</b><span>원래보다 나은 판</span></div>
    <div><b>${streak}<small>일</small></b><span>연속</span></div>`;
  $('doneList').innerHTML = set.items.map((x) => {
    const s = byId.get(x.sceneId);
    if (!s) return '';
    const o = outcomeOf(x.outcome);
    return `<li data-scene="${esc(s.id)}"><span class="badge sm ${o.tone}">${o.icon}</span>
      <span class="txt"><b>${esc(sceneName(s))} · ${esc(o.title(s))}</b><small>${esc(s.opp.name)} · ${esc(gameLabel(s))}</small></span>
      ${x.gain != null ? `<span class="gain ${gainClass(x.gain)}">${signed(x.gain)}</span>` : ''}</li>`;
  }).join('');
  const next = await nextScene();
  $('againBtn').disabled = !next;
  $('againBtn').textContent = next ? '한 세트 더' : '장면을 만드는 중…';
}

// 결과 아래에서 수순을 한 수씩 넘겨 본다.
// 좋은 수: 장면에서 좋은 수부터 이득이 확정될 때까지 / 둔 수: 내가(또는 원래 게임에서) 둔 수와 상대의 응수
// 끝난 판: 이번에 둔 수를 시작부터 끝까지
let cmpBoards = null; // 비교 탭의 작은 판 두 개(원래, 이번)

// 결과를 넘겨 보는 중이면 판 탭·밀기·키보드로도 넘긴다(◀ ▶ 바는 화면 아래에 떠 있다)
let reviewGo = null;

function reviewTap(el) {
  let x0 = null;
  el.addEventListener('pointerdown', (e) => { x0 = e.clientX; });
  el.addEventListener('pointerup', (e) => {
    if (!reviewGo || x0 == null || e.target.closest('button, #cmpMoves')) return; // 버튼·수순 표는 제 할 일만
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 40) return reviewGo(dx < 0 ? 1 : -1); // 밀기: 왼쪽으로 밀면 다음
    const r = el.getBoundingClientRect();
    const at = (e.clientX - r.left) / r.width;
    if (at < 0.4) reviewGo(-1);
    else if (at > 0.6) reviewGo(1);
  });
}
reviewTap($('board'));
reviewTap($('cmpPanel'));
document.addEventListener('keydown', (e) => {
  if (!reviewGo || e.target.closest('input, textarea')) return;
  if (e.key === 'ArrowLeft') reviewGo(-1);
  if (e.key === 'ArrowRight') reviewGo(1);
});

function closeCompare() {
  reviewGo = null;
  $('play').classList.remove('reviewing', 'done');
  $('play').classList.remove('comparing');
  cmpBoards?.forEach((b) => b.destroy());
  cmpBoards = null;
}

function showReview(scene, review, end, cmp) {
  const start = { fen: review.startFen, last: review.startLast, startPly: scene.startPly };
  const pre = review.prefix;
  // 원래 게임과 이번 판이 처음 갈라진 수
  const orig = cmp?.orig ?? review.lines.orig ?? [];
  const mine = cmp?.mine ?? end.steps;
  let split = mine.findIndex((m, k) => orig[k]?.uci !== m.uci);
  if (split < 0) split = null;
  const good = cmp?.good ?? null;
  const total = Math.max(orig.length, mine.length, good?.length ?? 0);
  let leftSrc = 'orig'; // 왼쪽 작은 판: 원래 | 좋은 수
  const views = {
    good: review.lines.good && { ...start, steps: [...pre, ...review.lines.good], pre: pre.length, arrow: 'good', first: pre.length },
    bad: review.lines.bad && { ...start, steps: [...pre, ...review.lines.bad], pre: pre.length, arrow: 'bad', first: pre.length },
    // 비교는 갈린 수를 둔 뒤부터(안 갈렸으면 끝 모습)
    cmp: { ...start, steps: { length: total }, first: split != null ? split + 1 : total },
  };
  const tabs = [...$('tabs').querySelectorAll('button')];
  for (const t of tabs) t.hidden = !views[t.dataset.view];
  let view = views.good ? 'good' : views.bad ? 'bad' : 'cmp';
  let step = views[view].first; // 0 = 시작한 판, k = k수 둔 뒤

  // 수 번호: 백 수마다, 흑 수는 줄 첫머리나 표시(장면) 바로 뒤에서만
  const label = (startPly, k, marked) => {
    const ply = startPly + k;
    const n = Math.floor(ply / 2) + 1;
    if (ply % 2 === 0) return `<i>${n}.</i>`;
    return k === 0 || marked ? `<i>${n}...</i>` : '';
  };
  const moveNo = (k) => {
    const ply = scene.startPly + k;
    return `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}`;
  };

  function drawLine() {
    const v = views[view];
    const line = v.steps;
    const fen = step ? line[step - 1].fen : v.fen;
    const last = step ? line[step - 1].uci : v.last;
    const next = line[step];
    // 좋은 수·둔 수는 장면부터 다음에 둘 수를 화살표로
    const arrow = next && step >= v.pre ? [{ uci: next.uci, kind: v.arrow }] : [];
    board.set(fen, [], last, arrow);
    $('lineText').innerHTML = line.map((m, k) => {
      const cls = [k < step - 1 ? 'done' : k === step - 1 ? 'now' : '', k < v.pre ? 'pre' : ''].filter(Boolean).join(' ');
      const mark = k === v.pre && k > 0 ? '<b class="sep">장면</b>' : '';
      return `${mark}${label(v.startPly, k, !!mark)}<span class="${cls}" data-step="${k + 1}">${esc(m.san)}</span>`;
    }).join(' ');
  }

  // 원래와 이번을 같은 수 번호로: 작은 판 두 개 + 수순 표
  function drawCompare() {
    if (!cmpBoards) {
      const bottom = scene.side ? 'b' : 'w';
      cmpBoards = [new Board($('cmpOrig'), { bottom }), new Board($('cmpMine'), { bottom })];
    }
    const at = (line) => {
      const k = Math.min(step, line.length);
      return k ? line[k - 1] : { fen: start.fen, uci: start.last, cp: null };
    };
    const leftLine = leftSrc === 'good' && good ? good : orig;
    const [o, m] = [at(leftLine), at(mine)];
    cmpBoards[0].set(o.fen, [], o.uci);
    cmpBoards[1].set(m.fen, [], m.uci);
    $('cmpOrigScore').textContent = o.cp != null ? pawns(o.cp) : '';
    $('cmpMineScore').textContent = m.cp != null ? pawns(m.cp) : '';
    for (const b of document.querySelectorAll('#cmpLeftPick button')) {
      b.setAttribute('aria-pressed', String(b.dataset.src === leftSrc));
      b.hidden = b.dataset.src === 'good' && !good;
    }
    const rows = [];
    for (let k = 0; k < total; k++) {
      const cell = (x, cls = '') => `<td class="m ${cls}">${x ? `${esc(x.san)}<small>${x.cp != null ? pawns(x.cp) : ''}</small>` : ''}</td>`;
      const cls = [k === step - 1 ? 'now' : '', k === split ? 'split' : ''].filter(Boolean).join(' ');
      const mineDiff = split != null && k >= split ? 'diff' : '';
      const goodDiff = good?.[k] && orig[k]?.uci !== good[k].uci ? 'better' : '';
      rows.push(`<tr class="${cls}" data-step="${k + 1}"><td class="n">${moveNo(k)}</td>${cell(orig[k])}${cell(mine[k], mineDiff)}${good ? cell(good[k], goodDiff) : ''}</tr>`);
    }
    $('cmpMoves').innerHTML = `<table class="${good ? 'three' : ''}"><thead><tr><th></th><th>원래</th><th>이번</th>${good ? '<th>좋은 수</th>' : ''}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
    $('cmpMoves').querySelector('tr.now')?.scrollIntoView({ block: 'nearest' });
  }

  function draw() {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.view === view)));
    const comparing = view === 'cmp';
    $('play').classList.toggle('comparing', comparing);
    $('cmpPanel').hidden = !comparing;
    $('lineText').hidden = comparing;
    if (comparing) drawCompare();
    else drawLine();
    const len = views[view].steps.length;
    // 가운데엔 지금 수(번호와 수), 비교에선 번호만
    const cur = step && !comparing ? views[view].steps[step - 1] : null;
    $('stepInfo').textContent = !step ? '시작' : comparing ? moveNo(step - 1) : `${moveAt(views[view].startPly, step - 1)} ${cur.san}`;
    $('stepCount').textContent = `${step} / ${len}`;
    $('prevStep').disabled = step === 0;
    $('nextStep').disabled = step === len;
  }
  const moveAt = (startPly, k) => {
    const ply = startPly + k;
    return `${Math.floor(ply / 2) + 1}${ply % 2 ? '...' : '.'}`;
  };

  for (const t of tabs) {
    t.onclick = () => {
      view = t.dataset.view;
      step = views[view].first;
      draw();
    };
  }
  const go = (d) => { step = Math.max(0, Math.min(views[view].steps.length, step + d)); draw(); };
  $('prevStep').onclick = () => go(-1);
  $('nextStep').onclick = () => go(1);
  reviewGo = go;
  const jump = (e) => {
    const k = e.target.closest('[data-step]')?.dataset.step;
    if (k) { step = Number(k); draw(); }
  };
  $('lineText').onclick = jump;
  $('cmpMoves').onclick = jump;
  $('cmpLeftPick').onclick = (e) => {
    const b = e.target.closest('[data-src]');
    if (!b) return;
    leftSrc = b.dataset.src;
    draw();
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
  for (const r of document.querySelectorAll('input[name=clockMode]')) r.checked = r.value === clockMode();
  $('aliasEdit').value = aliases().join(', ');
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

// ---- 공유로 받은 게임 복기 ----
let pendingShare = null; // 아이디를 넣기 전에 공유받으면 넣은 뒤에 연다

// 내 다른 아이디(부계정, Lichess 등). 이 이름이 있는 기보는 쪽을 고르지 않고 바로 내 쪽으로
function aliases() {
  try { return JSON.parse(localStorage.getItem('aliases') || '[]'); } catch { return []; }
}
function saveAliases(list) {
  const clean = [...new Set(list.map((n) => n.trim()).filter(Boolean))];
  try { localStorage.setItem('aliases', JSON.stringify(clean)); } catch {}
  return clean;
}
const myNames = () => [user, ...aliases()];

// 시계: 'app'(내 수 하나에 20초꼴) | 'original'(원래 게임에서 그때 남은 시간 + 수당 추가시간)
function clockMode() {
  try { return localStorage.getItem('clockMode') || 'app'; } catch { return 'app'; }
}

// 남의 게임: 어느 쪽으로 둘지 고른다. counts: 쪽마다 장면 후보 수, hint: 링크가 가리킨 쪽(0|1|null)
// 돌려주는 값: { side: 0 | 1, mine: 이 이름이 내 아이디인지 } | null(취소)
function chooseSide(g, counts, hint) {
  return new Promise((resolve) => {
    const label = (p, k) => `${k ? '흑' : '백'} · ${esc(p.username)}${p.rating ? ` ${p.rating}` : ''}`
      + (counts ? `<small>장면 ${counts[k]}개</small>` : '');
    $('shareNote').hidden = false;
    $('shareNote').innerHTML = `<div>다른 사람 게임이에요. 어느 쪽으로 둘까요?</div>
      <div class="side-pick">
        <button class="btn${hint === 1 ? ' quiet-alt' : ''}" type="button" data-side="0">${label(g.white, 0)}</button>
        <button class="btn${hint === 0 ? ' quiet-alt' : ''}" type="button" data-side="1">${label(g.black, 1)}</button>
      </div>
      <label class="mine-check"><input type="checkbox" id="mineCheck"> 고른 쪽 이름이 내 다른 아이디예요(다음부터 바로)</label>
      <button class="btn quiet" type="button" data-side="">취소</button>`;
    $('shareNote').onclick = (e) => {
      const b = e.target.closest('[data-side]');
      if (!b) return;
      $('shareNote').onclick = null;
      resolve(b.dataset.side === '' ? null : { side: Number(b.dataset.side), mine: $('mineCheck').checked });
    };
  });
}

// 공유 안내는 분석 진행 문구와 따로 둔다(덮이지 않게)
function shareNote(text) {
  $('shareNote').textContent = text;
  $('shareNote').hidden = !text;
}

async function openShared(text) {
  if (!text) return;
  if (!user) {
    pendingShare = text;
    return show('setup');
  }
  session?.abort();
  waitingForScene = false;
  await goHome();
  shareNote('공유한 게임을 찾는 중…');
  try {
    let { orient, ...g } = await findSharedGame(user, text, myNames());
    playEngine ??= new Engine(ENGINE_URL);
    await playEngine.init();
    if (!isMine(g, myNames()) && g.side == null) {
      shareNote('양쪽을 살펴보는 중…');
      const counts = await sideCounts(playEngine, g);
      const pick = await chooseSide(g, counts, orient === 'white' ? 0 : orient === 'black' ? 1 : null);
      if (!pick) return shareNote('');
      if (pick.mine) saveAliases([...aliases(), (pick.side ? g.black : g.white).username]);
      g = { ...g, side: pick.side, status: 'shared' };
      await store.put('games', g);
    }
    if (g.status !== 'done') {
      shareNote('공유한 게임을 분석하는 중…');
      await analyzeGame(playEngine, g, myNames());
    }
    const scenes = (await store.getAll('scenes')).filter((s) => s.gameUrl === g.url && !s.fake);
    if (!scenes.length) {
      shareNote('이 게임엔 놓친 기회나 큰 실수가 없었어요. 잘 둔 판이에요.');
      return;
    }
    shareNote('');
    focusGame = g.url;
    // 이미 다 둔 장면이면 가장 큰 것부터 다시
    const results = new Set((await store.getAll('results')).map((r) => r.sceneId));
    if (scenes.every((s) => results.has(s.id))) {
      replayScene = scenes.sort((a, b) => b.loss - a.loss)[0];
    }
    await startScene();
  } catch (err) {
    shareNote(err.message);
  }
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
  waitingForScene = !pendingShare;
  await goHome();
  runBackground().catch(() => {});
  if (pendingShare) {
    const text = pendingShare;
    pendingShare = null;
    openShared(text);
  }
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
for (const r of document.querySelectorAll('input[name=clockMode]')) {
  r.addEventListener('change', () => {
    try { localStorage.setItem('clockMode', r.value); } catch {}
  });
}
$('aliasForm').addEventListener('submit', (e) => {
  e.preventDefault();
  $('aliasEdit').value = saveAliases($('aliasEdit').value.split(/[,\s]+/)).join(', ');
  $('aliasSaved').hidden = false;
  setTimeout(() => { $('aliasSaved').hidden = true; }, 1500);
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
$('nextBtn').addEventListener('click', afterResult);
$('reviewNextBtn').addEventListener('click', afterResult);
$('reviewBtn').addEventListener('click', openReview);
$('againBtn').addEventListener('click', startScene);
$('doneHomeBtn').addEventListener('click', goHome);
// 지난 장면을 누르면 그 장면을 다시 둔다
for (const id of ['recent', 'doneList']) {
  $(id).addEventListener('click', async (e) => {
    const li = e.target.closest('[data-scene]');
    if (!li) return;
    replayScene = await store.get('scenes', li.dataset.scene);
    if (replayScene) startScene();
  });
}
$('quitBtn').addEventListener('click', goHome);
$('histPrev').addEventListener('click', () => viewHistory((viewing ?? past.length - 1) - 1));
$('histNext').addEventListener('click', () => viewHistory((viewing ?? past.length - 1) + 1));

// 웹: 새 버전의 서비스 워커가 자리 잡으면, 두는 중이 아닐 때 한 번 새로 고친다
let updateReady = false;
if ('serviceWorker' in navigator && !params.has('nosw') && !NATIVE) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('sw.js').catch(() => {});
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return; // 처음 설치될 때는 이미 새 파일이다
    if ($('play').hidden) location.reload();
    else updateReady = true;
  });
}

// 앱(안드로이드)은 AndroidShare로, 설치한 웹 앱은 주소의 text/url로 공유받은 글이 온다
function takeShared() {
  const fromApp = window.AndroidShare?.take?.();
  if (fromApp) return fromApp;
  const fromWeb = [params.get('text'), params.get('url')].filter(Boolean).join(' ');
  if (fromWeb) history.replaceState(null, '', location.pathname);
  return fromWeb || null;
}
window.addEventListener('shared', () => openShared(takeShared()));

(async () => {
  // 예전 장면에 원래 게임 시계 정보 채우기(기보만 읽어서 금방 끝난다)
  await backfillScenes().catch(() => {});
  // 예전 방식 장면이 있는 게임은 뒤에서 새 방식(시작 전 원래 수순, 2~4수 앞에서 섞어 시작)으로 다시 만든다
  await requeueOldScenes().catch(() => {});
  const shared = takeShared();
  if (shared) {
    if (user) await recordDay();
    await openShared(shared);
    if (user) runBackground().catch(() => {});
    return;
  }
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
