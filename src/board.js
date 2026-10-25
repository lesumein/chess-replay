// 탭으로 두는 체스판. 기물은 유니코드 글자로 그린다(그림 파일 없음).
import { boardFromFen } from './pgn.js';

const GLYPH = { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' };
const FILES = 'abcdefgh';

export class Board {
  constructor(el, { bottom = 'w', onMove }) {
    this.el = el;
    this.bottom = bottom;
    this.onMove = onMove;
    this.legal = [];
    this.selected = null;
    el.classList.add('board');
    el.addEventListener('click', (e) => {
      const sq = e.target.closest('[data-sq]')?.dataset.sq;
      if (sq) this.tap(sq);
    });
  }

  // legal: 지금 둘 수 있는 수(UCI). 비어 있으면 손댈 수 없다.
  set(fen, legal = [], lastMove = null) {
    this.fen = fen;
    this.pieces = boardFromFen(fen);
    this.legal = legal;
    this.lastMove = lastMove;
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
        const p = piece ? `<span class="pc ${piece === piece.toUpperCase() ? 'w' : 'b'}">${GLYPH[piece.toLowerCase()]}︎</span>` : '';
        const fileLabel = ri === 7 ? `<i class="cf">${f}</i>` : '';
        const rankLabel = fi === 0 ? `<i class="cr">${r}</i>` : '';
        html += `<div class="${cls.join(' ')}" data-sq="${sq}">${p}${fileLabel}${rankLabel}</div>`;
      });
    });
    this.el.innerHTML = html;
  }
}
