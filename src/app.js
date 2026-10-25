import { Engine } from './engine.js';
import { Board } from './board.js';
import { playScene } from './play.js';
import { refreshGames, pendingGames, analyzeGame } from './library.js';
import * as store from './store.js';

const ENGINE_URL = 'stockfish/stockfish-18-lite-single.js';
const FAKE_EVERY = 4; // 장면 네 개에 하나꼴로 가짜
const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

let user = '';
try { user = localStorage.getItem('user') || ''; } catch {}

let playEngine = null;
let bgEngine = null;
let bgRunning = null;
let board = null;
let session = null; // 지금 두는 장면을 멈출 AbortController

function show(view) {
  for (const v of ['setup', 'home', 'play']) $(v).hidden = v !== view;
}

function setNote(text) {
  $('note').textContent = text;
}

// ---- 백그라운드: 열 때마다 새 게임을 조금씩 분석해 쌓는다 ----
function runBackground(games = 2) {
  bgRunning ??= (async () => {
    try {
      bgEngine ??= new Engine(ENGINE_URL);
      await bgEngine.init();
      await refreshGames(user);
      for (let k = 0; k < games; k++) {
        const [g] = await pendingGames();
        if (!g) break;
        setNote(`새 게임 분석 중… (${new Date(g.endTime * 1000).toLocaleDateString('ko-KR')})`);
        try {
          await analyzeGame(bgEngine, g, user);
        } catch (err) {
          await store.put('games', { ...g, status: 'error', error: String(err.message) });
        }
        await renderHome();
      }
      setNote('');
    } catch (err) {
      setNote(err.message);
      throw err;
    } finally {
      bgRunning = null;
    }
  })();
  return bgRunning;
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
async function renderHome() {
  if ($('home').hidden) return;
  const [scenes, results, days] = await Promise.all([store.getAll('scenes'), store.getAll('results'), store.get('meta', 'days')]);
  const played = new Set(results.map((r) => r.sceneId));
  const judged = results.filter((r) => !r.fake && (r.outcome === 'found' || r.outcome === 'missed' || r.outcome === 'timeout'));
  const found = judged.filter((r) => r.outcome === 'found').length;
  const since = Date.now() - 14 * 86400e3;
  const recentDays = (days ?? []).filter((d) => new Date(d).getTime() >= since).length;
  $('stats').innerHTML = `
    <div><b>${judged.length ? `${found}/${judged.length}` : '–'}</b><span>찾은 장면</span></div>
    <div><b>${scenes.filter((s) => !played.has(s.id)).length}</b><span>남은 장면</span></div>
    <div><b>${recentDays}</b><span>최근 2주 연 날</span></div>`;
  $('playBtn').disabled = !(await nextScene());
}

async function goHome() {
  session?.abort();
  show('home');
  await renderHome();
}

// ---- 두기 ----
async function startScene() {
  session?.abort();
  const mine = (session = new AbortController());
  const scene = await nextScene();
  if (!scene) return goHome();
  show('play');
  $('result').hidden = true;
  $('opp').textContent = `${scene.opp.name}${scene.opp.rating ? ` (${scene.opp.rating})` : ''}`;
  $('me').textContent = scene.me.name;
  $('gameInfo').textContent = `${new Date(scene.endTime * 1000).toLocaleDateString('ko-KR')} · ${scene.timeClass}`;
  board = new Board($('board'), { bottom: scene.side ? 'b' : 'w', onMove: () => {} });
  playEngine ??= new Engine(ENGINE_URL);
  await playEngine.init();
  const result = await playScene(scene, playEngine, {
    board,
    clock: (ms) => {
      const s = Math.ceil(ms / 1000);
      $('clock').textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      $('clock').classList.toggle('low', s <= 10);
    },
    status: (text) => { $('turn').textContent = text; },
  }, { botDelay: params.has('fast') ? 0 : 600, signal: mine.signal });
  if (!result) return;
  const { text, ...record } = result;
  await store.add('results', record);
  $('resultText').textContent = text;
  $('resultLink').href = `${scene.gameUrl}?move=${scene.ply + 1}`;
  $('result').hidden = false;
}

// ---- 시작 ----
async function recordDay() {
  const today = new Date().toISOString().slice(0, 10);
  const days = (await store.get('meta', 'days')) ?? [];
  if (!days.includes(today)) await store.put('meta', [...days, today], 'days');
}

$('setupForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('user').value.trim();
  if (!name) return;
  if (name.toLowerCase() !== user.toLowerCase()) await store.clearAll();
  user = name;
  try { localStorage.setItem('user', user); } catch {}
  await recordDay();
  await goHome();
  setNote('게임을 가져오는 중…');
  runBackground().then(() => (!$('home').hidden && !$('playBtn').disabled ? startScene() : null)).catch(() => {});
});

$('playBtn').addEventListener('click', startScene);
$('nextBtn').addEventListener('click', startScene);
$('homeBtn').addEventListener('click', goHome);
$('quitBtn').addEventListener('click', goHome);
$('changeUser').addEventListener('click', () => {
  $('user').value = user;
  show('setup');
});

(async () => {
  if (!user) return show('setup');
  await recordDay();
  // 이미 만들어 둔 장면이 있으면 바로 두기, 그동안 뒤에서 새 게임을 쌓는다.
  const scene = await nextScene();
  if (scene) startScene();
  else await goHome();
  runBackground().catch(() => {});
})();
