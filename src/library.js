// Chess.com 공개 API에서 끝난 게임을 가져와 쌓고, 한 판씩 분석해 장면을 만든다.
// 아카이브에는 끝난 게임만 있다. 진행 중인 게임은 가져오지 않는다.
import { parsePgn, addTimeSpent, parseTimeControl } from './pgn.js';
import { replay, evaluateAll, classify } from './analyze.js';
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

// 한 판을 따라가며 얕게 분석해 둔다(쪽을 고르기 전에 양쪽 장면 수를 세는 데도 쓴다)
const prepared = new Map();

async function prepareGame(engine, g) {
  if (prepared.has(g.url)) return prepared.get(g.url);
  const { headers, moves } = parsePgn(g.pgn);
  if (moves.length < MIN_PLIES || headers.SetUp === '1') return null;
  addTimeSpent(moves, headers.TimeControl);
  const positions = await replay(engine, moves);
  const { evals } = await evaluateAll(engine, positions, SCAN_DEPTH);
  const p = { positions, evals, tc: parseTimeControl(headers.TimeControl) };
  prepared.set(g.url, p);
  return p;
}

// 남의 게임에서 쪽을 고를 때 보여 줄, 쪽마다 장면 후보 수(얕은 분석 기준)
export async function sideCounts(engine, g) {
  const p = await prepareGame(engine, g);
  if (!p) return null;
  const counts = [0, 0];
  for (let i = 0; i < p.positions.length - 1; i++) if (classify(p.positions, p.evals, i).kind) counts[i % 2]++;
  return counts;
}

// onScene: 장면이 하나 저장될 때마다 불린다. names: 내 아이디들(문자열 하나도 됨)
export async function analyzeGame(engine, g, names, onScene = () => {}) {
  const p = await prepareGame(engine, g);
  if (!p) {
    await store.put('games', { ...g, status: 'skipped' });
    return [];
  }
  const { positions, evals, tc } = p;
  prepared.delete(g.url);
  // 남의 게임은 고른 쪽(g.side), 내 게임은 내 쪽
  const side = g.side ?? (sameName(g.white.username, names) ? 0 : 1);
  const [me, opp] = side ? [g.black, g.white] : [g.white, g.black];
  const meta = {
    url: g.url,
    endTime: g.endTime,
    timeClass: g.timeClass,
    tc,
    me: { name: me.username, rating: me.rating, result: me.result },
    opp: { name: opp.username, rating: opp.rating },
  };
  // 다시 분석하는 게임이면 새 장면으로 덮어쓰고(같은 자리면 id가 같아 기록이 이어진다), 다 만든 뒤 남은 예전 장면을 지운다
  const oldIds = (await store.getAll('scenes')).filter((x) => x.gameUrl === g.url).map((x) => x.id);
  const scenes = await buildScenes(engine, meta, positions, evals, side, async (scene) => {
    await store.put('scenes', scene);
    onScene(scene);
  });
  const keep = new Set(scenes.map((x) => x.id));
  for (const id of oldIds) if (!keep.has(id)) await store.del('scenes', id);
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
// '공유하기'로 오는 것: Chess.com 게임 링크, Lichess 게임 링크, PGN. 끝난 일반 체스 게임이면 남의 게임도 받는다.
// Chess.com 링크는 내 아카이브에서만 찾을 수 있다(공개 API에는 게임 번호로 찾는 길이 없다).
// Lichess는 공개 API로 게임 번호에서 PGN을 바로 받는다(이용약관상 개인·상업 앱에서 사용 허용, 끝난 게임만).
export function parseShared(text = '') {
  if (/\[White "/.test(text) && /\[Black "/.test(text)) return { pgn: text };
  const li = /lichess\.org\/(?:game\/export\/)?([a-zA-Z0-9]{8})(?:[a-zA-Z0-9]{4})?(?:\/(white|black))?(?![a-zA-Z0-9])/.exec(text);
  if (li) return { lichess: li[1], orient: li[2] ?? null };
  const m = /chess\.com\/\S*?(\d{6,})/i.exec(text);
  return m ? { id: m[1] } : null;
}

async function fromLichess(id) {
  const res = await fetch(`https://lichess.org/game/export/${id}?clocks=true&evals=false&opening=false`, { headers: { Accept: 'application/x-chess-pgn' } });
  if (res.status === 404) throw new Error('Lichess에서 그 게임을 찾지 못했어요.');
  if (!res.ok) throw new Error(`Lichess에서 게임을 불러오지 못했어요 (${res.status}).`);
  return res.text();
}

const sameName = (name, names) => [names].flat().some((n) => n && name?.toLowerCase() === n.toLowerCase());

const SEARCH_MONTHS = 6; // 링크로 받은 게임을 최근 몇 달 안에서 찾는다

// names: 내 아이디들. 돌려주는 게임에 orient(링크가 가리킨 쪽, Lichess)가 붙을 수 있다.
export async function findSharedGame(user, text, names = [user]) {
  const shared = parseShared(text);
  if (!shared) throw new Error('Chess.com·Lichess 게임 링크나 PGN이 아니에요.');
  const g = shared.pgn ? gameFromPgn(shared.pgn)
    : shared.lichess ? gameFromPgn(await fromLichess(shared.lichess))
      : await findById(user, shared.id);
  const existing = await store.get('games', g.url);
  if (existing) return { ...existing, orient: shared.orient };
  // 남의 게임은 쪽을 고르기 전까지 뒤의 분석이 집어 가지 않게
  const rec = isMine(g, names) ? g : { ...g, status: 'shared' };
  await store.put('games', rec);
  return { ...rec, orient: shared.orient };
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

function gameFromPgn(pgn) {
  const { headers: h } = parsePgn(pgn);
  if (h.Variant && h.Variant !== 'Standard') throw new Error('일반 체스 게임만 복기할 수 있어요.');
  if (!h.Result || h.Result === '*') throw new Error('끝난 게임만 복기할 수 있어요.');
  if (h.SetUp === '1') throw new Error('처음 배치부터 둔 게임만 복기할 수 있어요.');
  const result = (white) => (h.Result === '1/2-1/2' ? 'agreed' : (h.Result === '1-0') === white ? 'win' : 'lose');
  const date = (h.EndDate || h.UTCDate || h.Date || '').replace(/\./g, '-');
  const time = h.EndTime || h.UTCTime || '00:00:00';
  const endTime = Math.floor((Date.parse(`${date}T${time}Z`) || Date.now()) / 1000);
  return {
    url: h.Link || (/^https?:/.test(h.Site ?? '') ? h.Site : `pgn:${h.White}-${h.Black}-${date}-${time}`),
    pgn,
    endTime,
    timeClass: timeClassOf(h.TimeControl),
    white: { username: h.White, rating: Number(h.WhiteElo) || undefined, result: result(true) },
    black: { username: h.Black, rating: Number(h.BlackElo) || undefined, result: result(false) },
    status: 'new',
  };
}

// 내가 둔 게임인지(아니면 어느 쪽으로 둘지 골라야 한다). names: 내 아이디들
export const isMine = (g, names) => sameName(g.white.username, names) || sameName(g.black.username, names);

// 예전에 만든 장면에 원래 게임 시계(시간 설정, 시작 때 남은 시간)와 이긴/진 판을 채운다.
// 기보만 다시 읽으면 돼서 엔진을 쓰지 않는다. 돌려주는 값: 채운 장면 수
export async function backfillScenes() {
  const old = (await store.getAll('scenes')).filter((s) => s.tc === undefined);
  if (!old.length) return 0;
  const games = new Map((await store.getAll('games')).map((g) => [g.url, g]));
  const filled = [];
  for (const s of old) {
    const g = games.get(s.gameUrl);
    let tc = null;
    let clockAtStart = null;
    if (g?.pgn) {
      const { headers, moves } = parsePgn(g.pgn);
      tc = parseTimeControl(headers.TimeControl);
      if (tc) clockAtStart = s.startPly >= 2 ? moves[s.startPly - 2]?.clock ?? null : tc.base;
    }
    const me = g ? (s.side ? g.black : g.white) : null;
    filled.push({ ...s, tc, clockAtStart, me: { ...s.me, result: s.me.result ?? me?.result } });
  }
  await store.putMany('scenes', filled);
  return filled.length;
}

// 예전 방식으로 만든 장면(시작 전 원래 수순·섞인 시작 지점이 없는 것)이 있는 게임을 다시 분석하도록 줄 세운다.
// 돌려주는 값: 다시 분석할 게임 수
export async function requeueOldScenes() {
  const urls = new Set((await store.getAll('scenes')).filter((s) => s.preLine === undefined).map((s) => s.gameUrl));
  if (!urls.size) return 0;
  const games = (await store.getAll('games')).filter((g) => urls.has(g.url) && g.status === 'done');
  await store.putMany('games', games.map((g) => ({ ...g, status: 'new' })));
  return games.length;
}
