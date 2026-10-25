// Stockfish를 Web Worker로 띄우고 UCI 문자열로만 주고받는다.
// Stockfish 파일은 stockfish/ 폴더에 수정 없이 두고, 여기서는 URL로만 참조한다.

export class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.listeners = [];
    this.worker.onmessage = (e) => {
      for (const line of String(e.data).split('\n')) {
        for (const fn of [...this.listeners]) fn(line);
      }
    };
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  // done(line)이 true를 돌려줄 때까지 받은 줄을 모아 돌려준다.
  collect(cmd, done) {
    return new Promise((resolve) => {
      const lines = [];
      const fn = (line) => {
        lines.push(line);
        if (done(line)) {
          this.listeners = this.listeners.filter((f) => f !== fn);
          resolve(lines);
        }
      };
      this.listeners.push(fn);
      this.send(cmd);
    });
  }

  async init() {
    await this.collect('uci', (l) => l === 'uciok');
    await this.ready();
  }

  ready() {
    return this.collect('isready', (l) => l === 'readyok');
  }

  async newGame() {
    this.send('ucinewgame');
    await this.ready();
  }

  // 합법 수 목록(UCI 표기)
  async legalMoves(fen) {
    this.send(`position fen ${fen}`);
    const lines = await this.collect('go perft 1', (l) => l.startsWith('Nodes searched'));
    return lines.map((l) => /^([a-h][1-8][a-h][1-8][nbrq]?): /.exec(l)).filter(Boolean).map((m) => m[1]);
  }

  // 수를 둔 뒤의 FEN과 체크 여부
  async play(fen, uci) {
    this.send(`position fen ${fen} moves ${uci}`);
    const lines = await this.collect('d', (l) => l.startsWith('Checkers:'));
    const fenLine = lines.find((l) => l.startsWith('Fen: '));
    const checkers = lines.find((l) => l.startsWith('Checkers:'));
    return { fen: fenLine.slice(5).trim(), check: checkers.slice(9).trim() !== '' };
  }

  // 둘 차례 쪽에서 본 점수. mate가 있으면 mate(수), 없으면 cp.
  async evaluate(fen, depth) {
    this.send(`position fen ${fen}`);
    const lines = await this.collect(`go depth ${depth}`, (l) => l.startsWith('bestmove'));
    let score = null;
    for (const l of lines) {
      const m = /^info .*\bscore (cp|mate) (-?\d+)/.exec(l);
      if (m && !/\bmultipv [2-9]/.test(l)) score = { type: m[1], value: Number(m[2]) };
    }
    const best = lines.at(-1).split(' ')[1];
    return { score: score ?? { type: 'cp', value: 0 }, best: best === '(none)' ? null : best };
  }

  terminate() {
    this.worker.terminate();
  }
}
