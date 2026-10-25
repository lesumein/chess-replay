// 체스판. 그리기와 손 입력은 cm-chessboard(MIT, vendor/cm-chessboard)에 맡기고,
// 기물은 그 안의 위키백과 표준 기물(CC BY-SA 3.0)을 쓴다.
import { Chessboard, COLOR, INPUT_EVENT_TYPE } from '../vendor/cm-chessboard/src/Chessboard.js';
import { Markers, MARKER_TYPE } from '../vendor/cm-chessboard/src/extensions/markers/Markers.js';
import { Arrows, ARROW_TYPE } from '../vendor/cm-chessboard/src/extensions/arrows/Arrows.js';

const ASSETS = new URL('../vendor/cm-chessboard/assets/', import.meta.url).href;
const ARROW = { good: ARROW_TYPE.success, bad: ARROW_TYPE.danger };

export class Board {
  constructor(el, { bottom = 'w', onMove }) {
    this.el = el;
    this.onMove = onMove;
    this.legal = [];
    this.queue = Promise.resolve();
    el.replaceChildren();
    this.cb = new Chessboard(el, {
      orientation: bottom === 'w' ? COLOR.white : COLOR.black,
      assetsUrl: ASSETS,
      style: { cssClass: 'default', borderType: 'none', animationDuration: 200 },
      extensions: [{ class: Markers, props: { autoMarkers: null } }, { class: Arrows }],
    });
  }

  // legal: 지금 둘 수 있는 수(UCI). 비어 있으면 손댈 수 없다.
  // arrows: [{ uci, kind: 'good' | 'bad' }]
  set(fen, legal = [], lastMove = null, arrows = []) {
    // 앞의 그리기(애니메이션)가 끝난 뒤에 차례로
    this.queue = this.queue.then(() => this.draw(fen, legal, lastMove, arrows));
    return this.queue;
  }

  async draw(fen, legal, lastMove, arrows) {
    this.legal = legal;
    this.el.dataset.legal = legal.join(' ');
    this.el.dataset.active = false;
    this.cb.disableMoveInput();
    this.cb.removeMarkers();
    this.cb.removeArrows();
    await this.cb.setPosition(fen, true);
    if (lastMove) {
      this.cb.addMarker(MARKER_TYPE.square, lastMove.slice(0, 2));
      this.cb.addMarker(MARKER_TYPE.square, lastMove.slice(2, 4));
    }
    for (const a of arrows) this.cb.addArrow(ARROW[a.kind], a.uci.slice(0, 2), a.uci.slice(2, 4));
    if (legal.length) {
      this.cb.enableMoveInput((e) => this.input(e), fen.split(' ')[1]);
      this.el.dataset.active = true;
    }
  }

  destroy() {
    this.cb.destroy();
  }

  input(e) {
    switch (e.type) {
      case INPUT_EVENT_TYPE.moveInputStarted: {
        const moves = this.legal.filter((u) => u.startsWith(e.squareFrom));
        this.cb.addLegalMovesMarkers(moves.map((u) => ({ to: u.slice(2, 4), promotion: u[4] })));
        return moves.length > 0;
      }
      case INPUT_EVENT_TYPE.validateMoveInput: {
        const moves = this.legal.filter((u) => u.startsWith(e.squareFrom + e.squareTo));
        if (!moves.length) return false;
        const uci = moves.find((u) => u.endsWith('q')) ?? moves[0]; // 승진은 퀸으로
        this.legal = [];
        this.el.dataset.active = false;
        // 판이 기물을 옮긴 뒤에 알린다
        setTimeout(() => this.onMove(uci));
        return true;
      }
      case INPUT_EVENT_TYPE.moveInputCanceled:
      case INPUT_EVENT_TYPE.moveInputFinished:
        this.cb.removeLegalMovesMarkers();
        return true;
      default:
        return true;
    }
  }
}
