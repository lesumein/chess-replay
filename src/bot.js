import { cp } from './analyze.js';

// 레이팅에 맞춰 일부러 약하게 두는 봇.
// Stockfish의 UCI_Elo는 1320 아래로 내려가지 않으므로, 후보 수를 여러 개 받아 레이팅에 따라 고른다.
// 레이팅이 낮을수록 점수 차를 덜 따지고(온도↑), 아무 수나 두는 일도 잦다(실수↑).

const lerp = (table, x) => {
  if (x <= table[0][0]) return table[0][1];
  for (let k = 1; k < table.length; k++) {
    const [x1, y1] = table[k];
    const [x0, y0] = table[k - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return table.at(-1)[1];
};

// 레이팅 → 후보 수 사이 점수 차에 대한 너그러움(센티폰)
const TEMPERATURE = [[100, 400], [400, 230], [800, 120], [1200, 60], [1600, 30], [2000, 12]];
// 레이팅 → 후보와 상관없이 아무 수나 둘 확률
const RANDOM = [[100, 0.25], [400, 0.12], [800, 0.05], [1200, 0.02], [1600, 0.005], [2000, 0]];
const DEPTH = 8;
const COUNT = 8;

export function botSettings(rating) {
  return { temperature: lerp(TEMPERATURE, rating), random: lerp(RANDOM, rating) };
}

export async function botMove(engine, fen, legal, rating, rand = Math.random) {
  const { temperature, random } = botSettings(rating);
  if (legal.length === 1) return legal[0];
  if (rand() < random) return legal[Math.floor(rand() * legal.length)];
  const list = await engine.candidates(fen, DEPTH, Math.min(COUNT, legal.length));
  if (!list.length) return legal[0];
  const top = cp(list[0].score);
  const weights = list.map((c) => Math.exp((cp(c.score) - top) / temperature));
  let r = rand() * weights.reduce((a, b) => a + b, 0);
  for (let k = 0; k < list.length; k++) {
    r -= weights[k];
    if (r <= 0) return list[k].best;
  }
  return list[0].best;
}
