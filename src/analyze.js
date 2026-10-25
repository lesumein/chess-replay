import { START_FEN, sanToUci, uciToSan } from './pgn.js';

// PGN의 수를 따라가며 각 포지션의 FEN과 합법 수를 구한다.
export async function replay(engine, moves, startFen = START_FEN) {
  const positions = [];
  let fen = startFen;
  let check = false;
  for (const mv of moves) {
    const legal = await engine.legalMoves(fen);
    const uci = sanToUci(mv.san, fen, legal);
    if (!uci) throw new Error(`수를 읽지 못했어요: ${mv.san}`);
    positions.push({ fen, check, legal, uci, san: mv.san, spent: mv.spent });
    ({ fen, check } = await engine.play(fen, uci));
  }
  positions.push({ fen, check, legal: await engine.legalMoves(fen) });
  return positions;
}

// 둘 차례 쪽 점수(센티폰). 메이트는 ±1000으로 자른다.
export function cp(score) {
  if (score.type === 'mate') return score.value > 0 ? 1000 : -1000;
  return Math.max(-1000, Math.min(1000, score.value));
}

export async function evaluateAll(engine, positions, depth, onProgress) {
  await engine.newGame();
  const evals = [];
  const t0 = performance.now();
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const t = performance.now();
    // 체크메이트·스테일메이트는 엔진에 묻지 않는다.
    evals.push(p.legal.length ? await engine.evaluate(p.fen, depth) : { score: { type: p.check ? 'mate' : 'cp', value: 0 }, best: null });
    evals.at(-1).ms = performance.now() - t;
    onProgress?.(i + 1, positions.length);
  }
  return { evals, ms: performance.now() - t0 };
}

// 1000점 이하 상대에서 승부를 가르는 차이: 대략 기물 하나(2.5폰) 이상
const LOSS = 250;

// side: 0 = 백, 1 = 흑. 그 쪽이 둔 수 가운데 놓친 기회·큰 실수를 고른다.
export async function findScenes(engine, positions, evals, side) {
  const scenes = [];
  for (let i = side; i < positions.length - 1; i += 2) {
    const p = positions[i];
    const best = evals[i].best;
    if (!best || best === p.uci) continue;
    const before = cp(evals[i].score);
    const after = -cp(evals[i + 1].score);
    const loss = before - after;
    let kind = null;
    if (loss >= LOSS && before >= 200) kind = 'missed';
    else if (loss >= LOSS && after <= -100) kind = 'blunder';
    if (!kind) continue;
    const next = await engine.play(p.fen, best);
    const mate = next.check && (await engine.legalMoves(next.fen)).length === 0;
    scenes.push({
      ply: i,
      moveNo: Math.floor(i / 2) + 1,
      side,
      kind,
      played: p.san,
      best: uciToSan(best, p.fen, p.legal, next.check, mate),
      before,
      after,
      mate: evals[i].score.type === 'mate' && evals[i].score.value > 0 ? evals[i].score.value : null,
      spent: p.spent,
      fen: p.fen,
    });
  }
  return scenes;
}
