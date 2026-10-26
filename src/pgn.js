// PGN 읽기, SAN ↔ UCI 변환. 합법 수 계산은 엔진(perft)에 맡기고 여기서는 문자열만 다룬다.

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export function parsePgn(pgn) {
  const headers = {};
  for (const m of pgn.matchAll(/^\[(\w+) "(.*)"\]\s*$/gm)) headers[m[1]] = m[2];
  const text = pgn.replace(/^\[.*\]\s*$/gm, '');
  const moves = [];
  const re = /\{([^}]*)\}|\([^)]*\)|\d+\.(?:\.\.)?|1-0|0-1|1\/2-1\/2|\*|\$\d+|([^\s{}()]+)/g;
  for (const m of text.matchAll(re)) {
    if (m[1] !== undefined) {
      const clk = /\[%clk (\d+):(\d+):(\d+(?:\.\d+)?)\]/.exec(m[1]);
      if (clk && moves.length) moves.at(-1).clock = +clk[1] * 3600 + +clk[2] * 60 + +clk[3];
    } else if (m[2] !== undefined) {
      moves.push({ san: m[2], clock: null });
    }
  }
  return { headers, moves };
}

// 각 수에 쓴 시간(초). 시계 정보가 없으면 null.
export function addTimeSpent(moves, timeControl) {
  const [base, inc] = (timeControl || '').split('+').map(Number);
  const last = [Number.isFinite(base) ? base : null, Number.isFinite(base) ? base : null];
  moves.forEach((mv, i) => {
    const side = i % 2;
    mv.spent = mv.clock != null && last[side] != null ? Math.max(0, last[side] - mv.clock + (inc || 0)) : null;
    last[side] = mv.clock;
  });
}

export function boardFromFen(fen) {
  const board = {};
  fen.split(' ')[0].split('/').forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += +ch;
      else board['abcdefgh'[f++] + (8 - r)] = ch;
    }
  });
  return board;
}

const pieceType = (ch) => ch.toUpperCase();

export function sanToUci(san, fen, legal) {
  const board = boardFromFen(fen);
  const clean = san.replace(/[+#!?]+$/, '');
  const white = fen.split(' ')[1] === 'w';
  if (/^[O0]-[O0](-[O0])?$/.test(clean)) {
    const rank = white ? '1' : '8';
    const to = clean.length > 3 ? 'c' : 'g';
    return legal.find((u) => u.slice(0, 2) === 'e' + rank && u.slice(2, 4) === to + rank && pieceType(board['e' + rank]) === 'K') ?? null;
  }
  const m = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQ]))?$/.exec(clean);
  if (!m) return null;
  const [, piece = 'P', file, rank, to, promo] = m;
  const found = legal.filter((u) => {
    const from = u.slice(0, 2);
    return (
      board[from] && pieceType(board[from]) === piece && u.slice(2, 4) === to &&
      (!file || from[0] === file) && (!rank || from[1] === rank) &&
      (u[4] || '') === (promo ? promo.toLowerCase() : '')
    );
  });
  return found.length === 1 ? found[0] : null;
}

// UCI → SAN. check: 둔 뒤 체크인지, mate: 둔 뒤 상대에게 합법 수가 없는지
export function uciToSan(uci, fen, legal, check, mate) {
  const board = boardFromFen(fen);
  const from = uci.slice(0, 2), to = uci.slice(2, 4);
  const piece = pieceType(board[from]);
  const capture = !!board[to] || (piece === 'P' && from[0] !== to[0]);
  let san;
  if (piece === 'K' && Math.abs(from.charCodeAt(0) - to.charCodeAt(0)) === 2) {
    san = to[0] === 'g' ? 'O-O' : 'O-O-O';
  } else if (piece === 'P') {
    san = (capture ? from[0] + 'x' : '') + to + (uci[4] ? '=' + uci[4].toUpperCase() : '');
  } else {
    const rivals = legal.filter((u) => u !== uci && u.slice(2, 4) === to && board[u.slice(0, 2)] && pieceType(board[u.slice(0, 2)]) === piece);
    let dis = '';
    if (rivals.length) {
      if (!rivals.some((u) => u[0] === from[0])) dis = from[0];
      else if (!rivals.some((u) => u[1] === from[1])) dis = from[1];
      else dis = from;
    }
    san = piece + dis + (capture ? 'x' : '') + to;
  }
  return san + (mate ? '#' : check ? '+' : '');
}

// 시간 설정 "300+5" → { base: 300, inc: 5 }. 데일리("1/86400")나 없으면 null
export function parseTimeControl(tc = '') {
  const m = /^(\d+)(?:\+(\d+))?$/.exec(tc.trim());
  return m ? { base: Number(m[1]), inc: Number(m[2] ?? 0) } : null;
}
