// 탭으로 두는 체스판. 기물은 이 저장소에서 직접 그린 SVG(폰 글꼴에 따라 모양이 바뀌지 않게).
import { boardFromFen } from './pgn.js';

const FILES = 'abcdefgh';
const BASE = '<rect x="9" y="35" width="27" height="6" rx="2"/>';
// viewBox 0 0 45 45
const SHAPES = {
  p: `<circle cx="22.5" cy="13" r="6"/><path d="M14 35c0-8 3-12 8.5-14.5C28 23 31 27 31 35z"/>${BASE}`,
  r: `<path d="M11 8h5v4h4V8h5v4h4V8h5v9H11z"/><path d="M14 17h17l-1 18H15z"/>${BASE}`,
  b: `<circle cx="22.5" cy="7" r="3"/><path d="M15 35c-2-9 1-17 7.5-24C29 18 32 26 30 35z"/><path class="ln" d="M22.5 17v9M18.5 21.5h8" fill="none"/>${BASE}`,
  n: `<path d="M13 35c0-7 2-11 6-15l-5 1c-3 0-4-3-2-5l8-8 2-4 2 4c7 2 11 9 10 27z"/><circle class="eye" cx="20" cy="13" r="1.6"/>${BASE}`,
  q: `<path d="M12 35 9 15l7 9 2.5-13 4 12 4-12L29 24l7-9-3 20z"/><circle cx="9" cy="13" r="2.5"/><circle cx="18.5" cy="9.5" r="2.5"/><circle cx="26.5" cy="9.5" r="2.5"/><circle cx="36" cy="13" r="2.5"/>${BASE}`,
  k: `<path d="M21 4h3v4h4v3h-4v7h-3v-7h-4V8h4z"/><path d="M13 35c-3-8-1-15 9.5-16C33 20 35 27 32 35z"/>${BASE}`,
};

const sqXY = (sq, bottom) => {
  const f = FILES.indexOf(sq[0]);
  const r = Number(sq[1]) - 1;
  return bottom === 'w' ? [f + 0.5, 7 - r + 0.5] : [7 - f + 0.5, r + 0.5];
};

export class Board {
  constructor(el, { bottom = 'w', onMove }) {
    this.el = el;
    this.bottom = bottom;
    this.onMove = onMove;
    this.legal = [];
    this.arrows = [];
    this.selected = null;
    el.classList.add('board');
    el.onclick = (e) => {
      const sq = e.target.closest('[data-sq]')?.dataset.sq;
      if (sq) this.tap(sq);
    };
  }

  // legal: 지금 둘 수 있는 수(UCI). 비어 있으면 손댈 수 없다.
  // arrows: [{ uci, kind: 'good' | 'bad' }]
  set(fen, legal = [], lastMove = null, arrows = []) {
    this.fen = fen;
    this.pieces = boardFromFen(fen);
    this.legal = legal;
    this.lastMove = lastMove;
    this.arrows = arrows;
    this.selected = null;
    this.el.dataset.active = legal.length > 0;
    this.render();
  }

  tap(sq) {
    if (this.selected) {
      const moves = this.legal.filter((u) => u.startsWith(this.selected + sq));
      if (moves.length) {
        const uci = moves.find((u) => u.endsWith('q')) ?? moves[0]; // 승진은 퀸으로
        this.legal = [];
        this.selected = null;
        this.el.dataset.active = false;
        this.render();
        this.onMove(uci);
        return;
      }
    }
    this.selected = this.legal.some((u) => u.startsWith(sq)) && this.selected !== sq ? sq : null;
    this.render();
  }

  render() {
    const targets = new Set(this.selected ? this.legal.filter((u) => u.startsWith(this.selected)).map((u) => u.slice(2, 4)) : []);
    const last = this.lastMove ? [this.lastMove.slice(0, 2), this.lastMove.slice(2, 4)] : [];
    const ranks = this.bottom === 'w' ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
    const files = this.bottom === 'w' ? FILES : [...FILES].reverse().join('');
    let html = '';
    ranks.forEach((r, ri) => {
      [...files].forEach((f, fi) => {
        const sq = f + r;
        const light = (FILES.indexOf(f) + r) % 2 === 1;
        const piece = this.pieces[sq];
        const cls = ['sq', light ? 'light' : 'dark'];
        if (last.includes(sq)) cls.push('last');
        if (sq === this.selected) cls.push('sel');
        if (targets.has(sq)) cls.push(piece ? 'hit' : 'dot');
        const p = piece
          ? `<svg class="pc ${piece === piece.toUpperCase() ? 'w' : 'b'}" viewBox="0 0 45 45" aria-label="${piece}">${SHAPES[piece.toLowerCase()]}</svg>`
          : '';
        const fileLabel = ri === 7 ? `<i class="cf">${f}</i>` : '';
        const rankLabel = fi === 0 ? `<i class="cr">${r}</i>` : '';
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${p}${fileLabel}${rankLabel}</div>`;
      });
    });
    this.el.innerHTML = html + this.arrowSvg();
  }

  arrowSvg() {
    if (!this.arrows.length) return '';
    const lines = this.arrows.map(({ uci, kind }) => {
      const [x1, y1] = sqXY(uci.slice(0, 2), this.bottom);
      const [x2, y2] = sqXY(uci.slice(2, 4), this.bottom);
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ex = x2 - ((x2 - x1) / len) * 0.3;
      const ey = y2 - ((y2 - y1) / len) * 0.3;
      return `<line class="arrow ${kind}" x1="${x1}" y1="${y1}" x2="${ex}" y2="${ey}" marker-end="url(#head-${kind})"/>`;
    });
    const marker = (kind) => `<marker id="head-${kind}" viewBox="0 0 4 4" refX="1.2" refY="2" markerWidth="2.6" markerHeight="2.6" orient="auto"><path class="arrow-head ${kind}" d="M0 0 4 2 0 4z"/></marker>`;
    return `<svg class="arrows" viewBox="0 0 8 8"><defs>${marker('good')}${marker('bad')}</defs>${lines.join('')}</svg>`;
  }
}
