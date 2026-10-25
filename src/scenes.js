import { classify, cp, sanOf } from './analyze.js';

export const LEAD = 4; // 장면 몇 수 전(내 수 기준)부터 두는지
export const AFTER = 2; // 장면 뒤로 내 수를 몇 수 더 두는지
const RECHECK_DEPTH = 16; // 폰에서 포지션당 최대 1~2초

// 분석한 한 판에서 다시 둘 장면(진짜 + 가짜 하나)을 만든다.
// game: { url, endTime, timeClass, me: {name, rating}, opp: {name, rating} }
// onScene: 장면 하나가 확정될 때마다 불린다(판 전체를 기다리지 않고 바로 저장하려고).
export async function buildScenes(engine, game, positions, evals, side, onScene = async () => {}) {
  const scenes = [];
  for (let i = side; i < positions.length - 1; i += 2) {
    if (!classify(positions, evals, i).kind) continue;
    // 얕은 분석으로 찾은 장면을 깊게 다시 본다. 사라지면 버린다.
    evals[i] = await engine.evaluate(positions[i].fen, RECHECK_DEPTH);
    if (positions[i + 1].legal.length) evals[i + 1] = await engine.evaluate(positions[i + 1].fen, RECHECK_DEPTH);
    const c = classify(positions, evals, i);
    if (!c.kind) continue;
    const p = positions[i];
    const refute = evals[i + 1].best;
    scenes.push({
      ...base(game, positions, i, side),
      fake: false,
      kind: c.kind,
      before: c.before,
      loss: c.loss,
      bestUci: evals[i].best,
      bestSan: await sanOf(engine, p.fen, p.legal, evals[i].best),
      mate: evals[i].score.type === 'mate' && evals[i].score.value > 0 ? evals[i].score.value : null,
      refuteSan: c.kind === 'blunder' && refute ? await sanOf(engine, positions[i + 1].fen, positions[i + 1].legal, refute) : null,
    });
    await onScene(scenes.at(-1));
  }
  const fake = pickQuiet(positions, evals, side, scenes);
  if (fake != null) {
    scenes.push({ ...base(game, positions, fake, side), fake: true, kind: 'quiet', before: cp(evals[fake].score), loss: 0 });
    await onScene(scenes.at(-1));
  }
  return scenes;
}

function base(game, positions, i, side) {
  const start = Math.max(i - 2 * LEAD, side);
  const end = Math.min(i + 2 * AFTER + 1, positions.length - 1);
  return {
    id: `${game.url}#${i}`,
    gameUrl: game.url,
    endTime: game.endTime,
    timeClass: game.timeClass,
    me: game.me,
    opp: game.opp,
    side,
    ply: i,
    moveNo: Math.floor(i / 2) + 1,
    startPly: start,
    startFen: positions[start].fen,
    // 원래 게임의 수. 내가 원래대로 두는 동안 상대도 원래대로 둔다.
    line: positions.slice(start, end).map((p) => p.uci),
    playedSan: positions[i].san,
    origSpent: positions[i].spent,
  };
}

// 앞뒤로 아무 일도 없던 포지션 하나(가짜 장면): 양쪽 모두 큰 손해 없이 둔 구간
function pickQuiet(positions, evals, side, scenes) {
  const found = [];
  for (let i = side + 2 * LEAD; i < positions.length - 2 * AFTER - 1; i += 2) {
    let quiet = true;
    for (let j = i - 2 * LEAD; j <= i + 2 * AFTER && quiet; j++) {
      if (Math.abs(cp(evals[j].score)) > 600 || !positions[j].legal.length) quiet = false;
      else if (classify(positions, evals, j).loss > 100) quiet = false;
    }
    if (quiet && !scenes.some((s) => Math.abs(s.ply - i) < 2 * LEAD)) found.push(i);
  }
  return found.length ? found[Math.floor(found.length / 2)] : null;
}
