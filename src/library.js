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

// 끝난 일반 체스 게임만
const playable = (g) => g.rules === 'chess' && g.pgn && !/\[Result "\*"\]/.test(g.pgn);
const toRecord = (g) => ({ url: g.url, pgn: g.pgn, endTime: g.end_time, timeClass: g.time_class, white: g.white, black: g.black, status: 'new' });

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
    const fresh = games.filter(playable).map(toRecord);
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
  // 남의 게임은 고른 쪽(g.side), 내 게임은 내 쪽
  const side = g.side ?? (g.white.username.toLowerCase() === user.toLowerCase() ? 0 : 1);
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

// ---- 공유로 받은 게임 ----
// Chess.com 앱의 '공유하기'는 게임 링크나 PGN을 보낸다. 끝난 일반 체스 게임이면 남의 게임도 받는다.
// 링크는 내 아카이브에서만 찾을 수 있다(공개 API에는 게임 번호로 찾는 길이 없다).
export function parseShared(text = '') {
  if (/\[White "/.test(text) && /\[Black "/.test(text)) return { pgn: text };
  const m = /chess\.com\/\S*?(\d{6,})/i.exec(text);
  return m ? { id: m[1] } : null;
}

const SEARCH_MONTHS = 6; // 링크로 받은 게임을 최근 몇 달 안에서 찾는다

export async function findSharedGame(user, text) {
  const shared = parseShared(text);
  if (!shared) throw new Error('Chess.com 게임 링크나 PGN이 아니에요.');
  const g = shared.pgn ? gameFromPgn(user, shared.pgn) : await findById(user, shared.id);
  const existing = await store.get('games', g.url);
  if (existing) return existing;
  // 남의 게임은 쪽을 고르기 전까지 뒤의 분석이 집어 가지 않게
  const rec = isMine(g, user) ? g : { ...g, status: 'shared' };
  await store.put('games', rec);
  return rec;
}

async function findById(user, id) {
  const sameId = (url = '') => url.endsWith('/' + id);
  const known = (await store.getAll('games')).find((g) => sameId(g.url));
  if (known) return known;
  const { archives } = await getJson(`${API}/${encodeURIComponent(user)}/games/archives`);
  for (const url of [...archives].reverse().slice(0, SEARCH_MONTHS)) {
    const { games } = await getJson(url);
    const found = games.find((g) => sameId(g.url));
    if (found) {
      if (!playable(found)) throw new Error('끝난 일반 체스 게임만 복기할 수 있어요.');
      return toRecord(found);
    }
  }
  throw new Error(`최근 ${SEARCH_MONTHS}달 내 게임에서 찾지 못했어요. 다른 사람 게임은 Chess.com에서 'PGN'으로 공유해 주세요.`);
}

function timeClassOf(tc = '') {
  if (tc.includes('/')) return 'daily';
  const [base, inc = 0] = tc.split('+').map(Number);
  const t = base + 40 * inc;
  return t < 180 ? 'bullet' : t < 600 ? 'blitz' : 'rapid';
}

function gameFromPgn(user, pgn) {
  const { headers: h } = parsePgn(pgn);
  if (h.Variant && h.Variant !== 'Standard') throw new Error('일반 체스 게임만 복기할 수 있어요.');
  if (!h.Result || h.Result === '*') throw new Error('끝난 게임만 복기할 수 있어요.');
  const result = (white) => (h.Result === '1/2-1/2' ? 'agreed' : (h.Result === '1-0') === white ? 'win' : 'lose');
  const date = (h.EndDate || h.UTCDate || h.Date || '').replace(/\./g, '-');
  const time = h.EndTime || h.UTCTime || '00:00:00';
  const endTime = Math.floor((Date.parse(`${date}T${time}Z`) || Date.now()) / 1000);
  return {
    url: h.Link || `pgn:${h.White}-${h.Black}-${date}-${time}`,
    pgn,
    endTime,
    timeClass: timeClassOf(h.TimeControl),
    white: { username: h.White, rating: Number(h.WhiteElo) || undefined, result: result(true) },
    black: { username: h.Black, rating: Number(h.BlackElo) || undefined, result: result(false) },
    status: 'new',
  };
}

// 내가 둔 게임인지(아니면 어느 쪽으로 둘지 골라야 한다)
export const isMine = (g, user) => [g.white.username, g.black.username].some((n) => n?.toLowerCase() === user.toLowerCase());
