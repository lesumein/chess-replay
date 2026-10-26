// Chess.com 공개 API에서 끝난 게임을 가져와 쌓고, 한 판씩 분석해 장면을 만든다.
// 아카이브에는 끝난 게임만 있다. 진행 중인 게임은 가져오지 않는다.
import { parsePgn, addTimeSpent } from './pgn.js';
import { replay, evaluateAll } from './analyze.js';
import { buildScenes } from './scenes.js';
import * as store from './store.js';

const API = 'https://api.chess.com/pub/player';
const SCAN_DEPTH = 12;
const MIN_PLIES = 20;

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(res.status === 404 ? '아이디를 찾지 못했어요.' : `게임을 불러오지 못했어요 (${res.status}).`);
  return res.json();
}

// 이번 달은 열 때마다, 지난 달은 분석할 게임이 모자랄 때 한 달씩만 가져온다.
// 돌려주는 값: 더 가져올 달이 남았는지
export async function refreshGames(user, want = 5) {
  const { archives } = await getJson(`${API}/${encodeURIComponent(user)}/games/archives`);
  const done = new Set((await store.get('meta', 'months')) ?? []);
  const known = new Set((await store.getAll('games')).filter((g) => g.status === 'new').map((g) => g.url));
  const months = [...archives].reverse();
  for (let k = 0; k < months.length; k++) {
    const url = months[k];
    if (k > 0 && done.has(url)) continue;
    const { games } = await getJson(url);
    const fresh = games
      .filter((g) => g.rules === 'chess' && g.pgn && !/\[Result "\*"\]/.test(g.pgn))
      .map((g) => ({ url: g.url, pgn: g.pgn, endTime: g.end_time, timeClass: g.time_class, white: g.white, black: g.black, status: 'new' }));
    const existing = new Set((await store.getAll('games')).map((g) => g.url));
    const added = fresh.filter((g) => !existing.has(g.url));
    await store.putMany('games', added);
    added.forEach((g) => known.add(g.url));
    if (k > 0) await store.put('meta', [...done.add(url)], 'months');
    if (k > 0 || known.size >= want) return true;
  }
  return false;
}

export async function pendingGames() {
  return (await store.getAll('games')).filter((g) => g.status === 'new').sort((a, b) => b.endTime - a.endTime);
}

// onScene: 장면이 하나 저장될 때마다 불린다
export async function analyzeGame(engine, g, user, onScene = () => {}) {
  const { headers, moves } = parsePgn(g.pgn);
  if (moves.length < MIN_PLIES || headers.SetUp === '1') {
    await store.put('games', { ...g, status: 'skipped' });
    return [];
  }
  addTimeSpent(moves, headers.TimeControl);
  const side = g.white.username.toLowerCase() === user.toLowerCase() ? 0 : 1;
  const [me, opp] = side ? [g.black, g.white] : [g.white, g.black];
  const positions = await replay(engine, moves);
  const { evals } = await evaluateAll(engine, positions, SCAN_DEPTH);
  const meta = {
    url: g.url,
    endTime: g.endTime,
    timeClass: g.timeClass,
    me: { name: me.username, rating: me.rating, result: me.result },
    opp: { name: opp.username, rating: opp.rating },
  };
  const scenes = await buildScenes(engine, meta, positions, evals, side, async (scene) => {
    await store.put('scenes', scene);
    onScene(scene);
  });
  await store.put('games', { ...g, status: 'done', scenes: scenes.length });
  return scenes;
}

// 새 게임을 가져와 최근 것부터 차례로 분석한다. 앱 화면과 백그라운드 작업이 같이 쓴다.
// shouldStop()은 판과 판 사이에서 본다. 돌려주는 값: 'done'(더 분석할 게임 없음) | 'stopped'
export async function analyzeMore(engine, user, { onGame, onGameDone, onScene, shouldStop = () => false, beforeEach } = {}) {
  let more = await refreshGames(user);
  while (!shouldStop()) {
    await beforeEach?.();
    const [g] = await pendingGames();
    if (!g) {
      if (!more) return 'done';
      more = await refreshGames(user);
      continue;
    }
    onGame?.(g);
    try {
      await analyzeGame(engine, g, user, onScene);
    } catch (err) {
      await store.put('games', { ...g, status: 'error', error: String(err.message) });
    }
    await onGameDone?.(g);
  }
  return 'stopped';
}
