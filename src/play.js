// 장면 하나를 봇과 다시 둔다. 장면이 어디인지는 끝날 때까지 알려 주지 않는다.
import { cp, sanOf, trimLine, walkLine, LOSS } from './analyze.js';
import { botMove } from './bot.js';
import { AFTER } from './scenes.js';

export const SECONDS_PER_MOVE = 20; // 래피드 정도: 내 수 하나에 평균 20초
const JUDGE_DEPTH = 14;
const OK_LOSS = 120; // 최선과 이 정도 차이면 찾은 것으로 본다
const CHECK_DEPTH = 12; // 끝난 뒤 이번 판을 훑어보는 깊이(원래 게임과 비교, 다른 길에서 놓친 것)
const PREROLL_MS = 450; // 원래 게임 앞 수순을 보여 주는 속도

// ui: { board, clock(ms), turn('me' | 'opp' | null), history(positions), preroll(on), skipPreroll() }
// signal로 중간에 그만두면 null을 돌려준다.
// clockMode: 'app'(내 수 하나에 20초꼴) | 'original'(원래 게임에서 그때 남은 시간 + 수당 추가시간)
export function clockFor(scene, clockMode) {
  const myMoves = (scene.ply - scene.startPly) / 2 + 1 + AFTER;
  if (clockMode === 'original' && scene.clockAtStart != null && scene.tc) {
    return { start: scene.clockAtStart * 1000, inc: scene.tc.inc * 1000 };
  }
  return { start: SECONDS_PER_MOVE * 1000 * myMoves, inc: 0 };
}

export async function playScene(scene, engine, ui, { botDelay = 600, signal, clockMode = 'app' } = {}) {
  const side = scene.side;
  const endPly = scene.ply + 2 * AFTER;
  let fen = scene.startFen;
  let ply = scene.startPly;
  let last = scene.preLine?.at(-1) ?? null;
  let onLine = true;
  const { start: clockStart, inc } = clockFor(scene, clockMode);
  let clock = clockStart;
  let atScene = null; // { fen, legal, uci, ms }
  let timedOut = false;
  const history = [{ fen, last }]; // 이번에 지나온 포지션들(되돌려 보기용)
  const played = [];

  ui.clock(clock);
  ui.history?.(history);
  await engine.newGame();
  await preroll(scene, engine, ui, botDelay ? PREROLL_MS : 0, signal);
  if (signal?.aborted) return null;
  while (true) {
    const legal = await engine.legalMoves(fen);
    if (!legal.length) break;
    let uci;
    if (ply % 2 === side) {
      ui.turn('me');
      const t0 = performance.now();
      uci = await waitForMove(ui, fen, legal, last, clock, (left) => ui.clock(left), signal);
      if (signal?.aborted) return null;
      const ms = performance.now() - t0;
      if (!uci) {
        timedOut = true;
        ui.clock(0);
        break;
      }
      clock += inc - ms; // 둔 뒤 수당 추가시간
      ui.clock(clock);
      if (ply === scene.ply && onLine) atScene = { fen, legal, uci, ms };
      if (onLine && uci !== scene.line[ply - scene.startPly]) onLine = false;
    } else {
      ui.board.set(fen, [], last);
      ui.turn('opp');
      const original = onLine ? scene.line[ply - scene.startPly] : null;
      const [move] = await Promise.all([original ?? botMove(engine, fen, legal, scene.opp.rating ?? 800), sleep(botDelay)]);
      uci = move;
      if (signal?.aborted) return null;
    }
    let check;
    ({ fen, check } = await engine.play(fen, uci));
    last = uci;
    played.push(uci);
    history.push({ fen, last, check });
    ui.history?.(history);
    ply++;
    if (ply > endPly) break;
  }
  ui.board.set(fen, [], last);
  ui.turn(null);
  const { badLine, ...result } = await judge(scene, engine, atScene, timedOut);
  // 끝난 판: 이번에 둔 수를 시작부터 넘겨 볼 수 있게
  const end = { fen: scene.startFen, last: history[0].last, startPly: scene.startPly, steps: await walkLine(engine, scene.startFen, played) };
  const check = await checkGame(scene, engine, history, played, atScene);
  if (result.outcome === 'deviated') result.text = describe(scene, 'deviated', '', check.issue);
  const rev = await review(scene, engine, atScene, result.outcome, badLine);
  // 비교 탭: 원래와 이번을 같은 수 번호로 나란히, 수마다 형세(내 쪽 점수)
  const cmp = {
    orig: await withScores(engine, scene, rev.lines.orig ?? []),
    mine: await withScores(engine, scene, end.steps),
    // 좋은 수 갈래: 장면까지는 원래 흐름, 장면부터 좋은 수
    good: rev.lines.good ? await withScores(engine, scene, [...rev.prefix, ...rev.lines.good]) : null,
    // 내 수마다 잃은 점수(결과의 '원래 대비'와 같은 계산). 좋은 수 갈래는 장면까지 원래와 같고 그 뒤로는 0
    loss: { ...check.losses, good: rev.lines.good ? check.losses.orig.slice(0, rev.prefix.length) : null },
  };
  return { ...result, compare: check.compare, review: rev, end, cmp };
}

const SCORE_DEPTH = 10;

// 수순의 각 포지션에 내 쪽에서 본 점수(cp)를 붙인다
async function withScores(engine, scene, steps) {
  const out = [];
  for (let k = 0; k < steps.length; k++) {
    const ply = scene.startPly + k + 1; // 이 수를 둔 뒤 둘 차례인 반수
    const legal = await engine.legalMoves(steps[k].fen);
    const score = legal.length
      ? (await engine.evaluate(steps[k].fen, SCORE_DEPTH)).score
      : { type: steps[k].san.endsWith('#') ? 'mate' : 'cp', value: 0 };
    out.push({ ...steps[k], cp: ply % 2 === scene.side ? cp(score) : -cp(score) });
  }
  return out;
}

// 시작 전에 원래 게임의 앞 수순을 빠르게 다시 보여 준다(오래된 게임도 흐름이 떠오르게). 탭하면 건너뛴다.
async function preroll(scene, engine, ui, ms, signal) {
  if (!scene.preLine?.length) return;
  ui.preroll?.(true);
  let fen = scene.preFen;
  ui.board.set(fen, []);
  for (const uci of scene.preLine) {
    await sleep(ms);
    if (signal?.aborted || ui.skipPreroll?.()) break;
    ({ fen } = await engine.play(fen, uci));
    ui.board.set(fen, [], uci);
  }
  ui.preroll?.(false);
}

// 끝난 뒤 이번 판을 훑어본다.
// compare: 같은 구간에서 내 수가 잃은 점수의 합 — 원래 게임 vs 이번
// issue: 장면 말고, 이번에 둔 길에서 놓친 기회나 큰 실수 중 첫 번째
const MAX_LOSS = 1000;
async function checkGame(scene, engine, history, played, atScene) {
  const side = scene.side;
  const mine = (ply, score) => (ply % 2 === side ? cp(score) : -cp(score));
  const evals = [];
  for (let k = 0; k < history.length; k++) {
    const legal = await engine.legalMoves(history[k].fen);
    // 체크메이트·스테일메이트는 엔진에 묻지 않는다
    evals.push(legal.length
      ? { ...(await engine.evaluate(history[k].fen, CHECK_DEPTH)), legal }
      : { score: { type: history[k].check ? 'mate' : 'cp', value: 0 }, legal });
  }
  const n = played.length;
  // 원래 게임에서 같은 수만큼(원래가 먼저 끝났으면 거기까지) 둔 포지션들의 평가
  const m = Math.min(n, scene.line.length);
  const origEvals = [evals[0]];
  let origFen = scene.startFen;
  for (let k = 0; k < m; k++) {
    const r = await engine.play(origFen, scene.line[k]);
    origFen = r.fen;
    const legal = await engine.legalMoves(origFen);
    origEvals.push(legal.length ? await engine.evaluate(origFen, CHECK_DEPTH) : { score: { type: r.check ? 'mate' : 'cp', value: 0 } });
  }
  // 내 수마다 최선 대비 잃은 점수(한 수 최대 10폰)를 더한다. 상대(봇) 수는 빼고 내 판단만.
  // 수마다 잃은 점수(상대 수는 null). 비교 탭에서 수를 넘길 때 여기까지의 합을 보여 준다
  const losses = (ev, count) => Array.from({ length: count }, (_, k) => ((scene.startPly + k) % 2 !== side
    ? null
    // 0.1폰 단위로 맞춰 두어, 화면에 보이는 합들이 서로 정확히 맞게
    : Math.round(Math.min(MAX_LOSS, Math.max(0, cp(ev[k].score) + cp(ev[k + 1].score))) / 10) * 10));
  const sum = (list) => list.reduce((a, x) => a + (x ?? 0), 0);
  const origLoss = losses(origEvals, m);
  const mineLoss = losses(evals, n);

  let issue = null;
  for (let k = 0; k < n && !issue; k++) {
    const ply = scene.startPly + k;
    if (ply % 2 !== side || (atScene && ply === scene.ply)) continue;
    const before = cp(evals[k].score);
    const after = -cp(evals[k + 1].score);
    const best = evals[k].best;
    if (!best || best === played[k] || before - after < LOSS) continue;
    if (before >= 200 || after <= -100) {
      issue = { moveNo: Math.floor(ply / 2) + 1, bestSan: await sanOf(engine, history[k].fen, evals[k].legal, best), kind: before >= 200 ? 'missed' : 'blunder' };
    }
  }
  return { compare: { loss: true, orig: sum(origLoss), now: sum(mineLoss.slice(0, m)) }, losses: { orig: origLoss, mine: mineLoss }, issue };
}

function waitForMove(ui, fen, legal, last, clockMs, onTick, signal) {
  return new Promise((resolve) => {
    const start = performance.now();
    const timer = setInterval(() => {
      if (signal?.aborted) return finish(null);
      const left = clockMs - (performance.now() - start);
      onTick(Math.max(0, left));
      if (left <= 0) finish(null);
    }, 200);
    const finish = (uci) => {
      clearInterval(timer);
      ui.board.onMove = () => {};
      resolve(uci);
    };
    ui.board.onMove = finish;
    ui.board.set(fen, legal, last);
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function judge(scene, engine, atScene, timedOut) {
  const base = { sceneId: scene.id, fake: scene.fake, at: Date.now() };
  if (!atScene) return { ...base, outcome: timedOut ? 'timeout' : 'deviated', text: describe(scene, timedOut ? 'timeout' : 'deviated') };
  let loss = 0;
  let reply = [];
  if (atScene.uci !== scene.bestUci) {
    const next = await engine.play(atScene.fen, atScene.uci);
    const ev = await engine.evaluate(next.fen, JUDGE_DEPTH);
    loss = scene.before - -cp(ev.score);
    reply = trimLine(ev.pv, ev.score);
  }
  const userSan = await sanOf(engine, atScene.fen, atScene.legal, atScene.uci);
  const outcome = loss <= OK_LOSS ? 'found' : 'missed';
  // 둔 수가 나빴으면 그 뒤 상대의 응수까지 보여 준다
  const badLine = outcome === 'missed' ? [atScene.uci, ...reply] : null;
  return { ...base, outcome, ms: atScene.ms, text: describe(scene, outcome, userSan), badLine };
}

// 끝난 뒤 판에 보여 줄 장면: 원래 게임의 그 포지션, 좋은 수(초록)와 내가 둔 수(빨강),
// 그리고 넘겨 볼 수순 두 줄(좋은 수부터 / 둔 수와 상대의 응수)
// prefix: 시작한 판에서 장면까지 원래 게임의 수순(좋은 수·둔 수 앞에 이어 붙여 어떻게 그 상태가 됐는지 보이게)
// lines.orig: 시작한 판부터 원래 게임에서 둔 수순(이번 판과 견주어 어디서 갈렸는지)
async function review(scene, engine, atScene, outcome, badLine) {
  const startLast = scene.preLine?.at(-1) ?? null;
  const prefix = await walkLine(engine, scene.startFen, scene.line.slice(0, scene.ply - scene.startPly));
  const fen = prefix.at(-1)?.fen ?? scene.startFen;
  const last = prefix.at(-1)?.uci ?? startLast;
  const arrows = [];
  if (!scene.fake) arrows.push({ uci: scene.bestUci, kind: 'good' });
  const mine = atScene?.uci;
  if (mine && mine !== scene.bestUci && (outcome !== 'found' || scene.fake)) arrows.push({ uci: mine, kind: scene.fake && outcome === 'found' ? 'good' : 'bad' });

  let good = null;
  if (!scene.fake) {
    // 수순을 저장하기 전에 만든 장면은 지금 계산한다
    let ucis = scene.bestLine;
    if (!ucis?.length) {
      const ev = await engine.evaluate(fen, 16);
      ucis = ev.best === scene.bestUci ? trimLine(ev.pv, ev.score) : [scene.bestUci];
    }
    good = await walkLine(engine, fen, ucis);
  }
  // 장면까지 못 갔어도, 큰 실수였다면 원래 게임에서 둔 수와 상대의 응수를 보여 준다
  if (!badLine && !atScene && scene.kind === 'blunder' && scene.refuteLine) {
    badLine = [scene.line[scene.ply - scene.startPly], ...scene.refuteLine];
  }
  const bad = badLine ? await walkLine(engine, fen, badLine) : null;
  const orig = await walkLine(engine, scene.startFen, scene.line);
  return {
    fen, last, arrows, prefix, startFen: scene.startFen, startLast,
    lines: { good: good?.length ? good : null, bad: bad?.length ? bad : null, orig: orig.length ? orig : null },
  };
}

// 받침 있는 글자로 끝나는지(SAN 끝 글자를 읽는 소리 기준)
function hasBatchim(san) {
  const ch = san.at(-1);
  if (ch === '+' || ch === '#') return false; // 체크, 메이트
  if (ch === 'O') return true; // 캐슬링
  return '01367'.includes(ch) || ch === '8';
}
const josa = (san, withB, withoutB) => san + (hasBatchim(san) ? withB : withoutB);

function motif(scene) {
  if (scene.mate) return `${scene.mate}수 메이트였어요.`;
  const check = /[+#]$/.test(scene.bestSan);
  const capture = scene.bestSan.includes('x');
  if (check && capture) return '체크하면서 기물을 따는 수였어요.';
  if (capture) return '기물을 따는 수였어요.';
  if (check) return '체크로 시작하는 수였어요.';
  return '';
}

export function describe(scene, outcome, userSan = '', issue = null) {
  const n = `${scene.moveNo}수`;
  const answer = scene.fake
    ? `${n}엔 특별한 수가 없었어요.`
    : scene.kind === 'blunder'
      ? `${n}엔 ${josa(scene.bestSan, '이', '가')} 안전했어요.`
      : `${n}에 ${josa(scene.bestSan, '이', '가')} 있었어요. ${motif(scene)}`.trim();
  switch (outcome) {
    case 'found':
      if (scene.fake) return `${answer} 흔들리지 않고 잘 넘겼어요.`;
      if (scene.kind === 'blunder') return `${n}에서 위험을 피했어요. ${josa(scene.bestSan, '이', '가')} 안전한 수였어요.`;
      return userSan === scene.bestSan ? `${n}에서 ${josa(scene.bestSan, '을', '를')} 찾았어요.` : `${n}에서 ${userSan}, 좋은 수였어요. ${josa(scene.bestSan, '도', '도')} 있었어요.`;
    case 'missed':
      if (scene.fake) return `${answer} ${userSan} 뒤로 형세가 나빠졌어요.`;
      if (scene.kind === 'blunder' && userSan === scene.playedSan && scene.refuteSan) {
        return `${n} ${userSan} 뒤엔 상대에게 ${josa(scene.refuteSan, '이', '가')} 있었어요. ${josa(scene.bestSan, '이', '가')} 안전했어요.`;
      }
      return answer;
    case 'timeout':
      return answer;
    default:
      if (!issue) return `원래 게임과 달라져 그 장면은 오지 않았고, 이번 길에선 큰 실수가 없었어요.`;
      return issue.kind === 'missed'
        ? `원래 게임과 달라져 그 장면은 오지 않았어요. 이번 길에선 ${issue.moveNo}수에 ${josa(issue.bestSan, '이', '가')} 있었어요.`
        : `원래 게임과 달라져 그 장면은 오지 않았어요. 이번 길에선 ${issue.moveNo}수에 ${josa(issue.bestSan, '이', '가')} 안전했어요.`;
  }
}
