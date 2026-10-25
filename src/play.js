// 장면 하나를 봇과 다시 둔다. 장면이 어디인지는 끝날 때까지 알려 주지 않는다.
import { cp, sanOf } from './analyze.js';
import { botMove } from './bot.js';
import { AFTER, LEAD } from './scenes.js';

export const SECONDS_PER_MOVE = 20; // 래피드 정도: 내 수 하나에 평균 20초
const JUDGE_DEPTH = 14;
const OK_LOSS = 120; // 최선과 이 정도 차이면 찾은 것으로 본다

// ui: { board, clock(ms), status(text) }
// signal로 중간에 그만두면 null을 돌려준다.
export async function playScene(scene, engine, ui, { botDelay = 600, signal } = {}) {
  const side = scene.side;
  const endPly = scene.ply + 2 * AFTER;
  let fen = scene.startFen;
  let ply = scene.startPly;
  let last = null;
  let onLine = true;
  let clock = SECONDS_PER_MOVE * 1000 * (LEAD + 1 + AFTER);
  let atScene = null; // { fen, legal, uci, ms }
  let timedOut = false;

  ui.clock(clock);
  await engine.newGame();
  while (true) {
    const legal = await engine.legalMoves(fen);
    if (!legal.length) break;
    let uci;
    if (ply % 2 === side) {
      ui.status('');
      const t0 = performance.now();
      uci = await waitForMove(ui, fen, legal, last, clock, (left) => ui.clock(left), signal);
      if (signal?.aborted) return null;
      const ms = performance.now() - t0;
      if (!uci) {
        timedOut = true;
        ui.clock(0);
        break;
      }
      clock -= ms;
      ui.clock(clock);
      if (ply === scene.ply && onLine) atScene = { fen, legal, uci, ms };
      if (onLine && uci !== scene.line[ply - scene.startPly]) onLine = false;
    } else {
      ui.board.set(fen, [], last);
      ui.status('상대 차례');
      const original = onLine ? scene.line[ply - scene.startPly] : null;
      const [move] = await Promise.all([original ?? botMove(engine, fen, legal, scene.opp.rating ?? 800), sleep(botDelay)]);
      uci = move;
      if (signal?.aborted) return null;
    }
    ({ fen } = await engine.play(fen, uci));
    last = uci;
    ply++;
    if (ply > endPly) break;
  }
  ui.board.set(fen, [], last);
  ui.status('');
  return judge(scene, engine, atScene, timedOut);
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
  if (atScene.uci !== scene.bestUci) {
    const next = await engine.play(atScene.fen, atScene.uci);
    const after = -cp((await engine.evaluate(next.fen, JUDGE_DEPTH)).score);
    loss = scene.before - after;
  }
  const userSan = await sanOf(engine, atScene.fen, atScene.legal, atScene.uci);
  const outcome = loss <= OK_LOSS ? 'found' : 'missed';
  return { ...base, outcome, ms: atScene.ms, text: describe(scene, outcome, userSan) };
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

export function describe(scene, outcome, userSan = '') {
  const n = `${scene.moveNo}수`;
  const answer = scene.fake
    ? `${n}엔 특별한 수가 없었어요.`
    : scene.kind === 'blunder'
      ? `${n}엔 ${josa(scene.bestSan, '이', '가')} 안전했어요.`
      : `${n}에 ${josa(scene.bestSan, '이', '가')} 있었어요. ${motif(scene)}`.trim();
  switch (outcome) {
    case 'found':
      if (scene.fake) return `${answer} 잘 넘겼어요 ✅`;
      if (scene.kind === 'blunder') return `${n}에서 위험을 피했어요 ✅`;
      return userSan === scene.bestSan ? `${n}에서 ${josa(scene.bestSan, '을', '를')} 찾았어요 ✅` : `${n}에서 좋은 수를 찾았어요 ✅ (${scene.bestSan}도 있었어요)`;
    case 'missed':
      if (scene.fake) return `${answer} ${userSan} 뒤로 형세가 나빠졌어요.`;
      if (scene.kind === 'blunder' && userSan === scene.playedSan && scene.refuteSan) {
        return `${n} ${userSan} 뒤엔 상대에게 ${josa(scene.refuteSan, '이', '가')} 있었어요. ${josa(scene.bestSan, '이', '가')} 안전했어요.`;
      }
      return answer;
    case 'timeout':
      return `시간이 다 됐어요. ${answer}`;
    default:
      return `원래 게임과 다른 길로 갔어요. ${answer}`;
  }
}
