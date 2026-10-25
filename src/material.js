// 기물 수 우위: 양쪽이 잡은 기물과 점수 차(폰 1, 나이트·비숍 3, 룩 5, 퀸 9)
import { boardFromFen } from './pgn.js';

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START = { p: 8, n: 2, b: 2, r: 2, q: 1 };
const ORDER = ['p', 'n', 'b', 'r', 'q'];

// 돌려주는 값: { w: { took: ['p','n',…], plus }, b: {…} } — w.took은 백이 잡은 흑 기물
export function material(fen) {
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const piece of Object.values(boardFromFen(fen))) {
    const side = piece === piece.toUpperCase() ? 'w' : 'b';
    const t = piece.toLowerCase();
    if (t in count[side]) count[side][t]++;
  }
  const score = (side) => ORDER.reduce((sum, t) => sum + count[side][t] * VALUE[t], 0);
  // 승진으로 START보다 많아지면 잡힌 것으로 치지 않는다
  const took = (from) => ORDER.flatMap((t) => Array(Math.max(0, START[t] - count[from][t])).fill(t));
  const diff = score('w') - score('b');
  return {
    w: { took: took('b'), plus: Math.max(0, diff) },
    b: { took: took('w'), plus: Math.max(0, -diff) },
  };
}
