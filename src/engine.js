// Stockfish를 Web Worker로 띄우고 UCI 문자열로만 주고받는다.
// Stockfish 파일은 stockfish/ 폴더에 수정 없이 두고, 여기서는 URL로만 참조한다.

export class Engine {
  constructor(url) {
    this.worker = new Worker(url);
    this.listeners = [];
    this.queue = Promise.resolve();
    this.worker.onmessage = (e) => {
      for (const line of String(e.data).split('\n')) {
        for (const fn of [...this.listeners]) fn(line);
      }
    };
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  // 명령이 섞이지 않도록 한 번에 하나씩 돌린다.
  exclusive(fn) {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => {});
    return run;
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

  init() {
    return this.exclusive(async () => {
      await this.collect('uci', (l) => l === 'uciok');
      await this.collect('isready', (l) => l === 'readyok');
    });
  }

  newGame() {
    return this.exclusive(async () => {
      this.send('ucinewgame');
      await this.collect('isready', (l) => l === 'readyok');
    });
  }

  // 합법 수 목록(UCI 표기)
  legalMoves(fen) {
    return this.exclusive(async () => {
      this.send(`position fen ${fen}`);
      const lines = await this.collect('go perft 1', (l) => l.startsWith('Nodes searched'));
      return lines.map((l) => /^([a-h][1-8][a-h][1-8][nbrq]?): /.exec(l)).filter(Boolean).map((m) => m[1]);
    });
  }

  // 수를 둔 뒤의 FEN과 체크 여부
  play(fen, uci) {
    return this.exclusive(async () => {
      this.send(`position fen ${fen} moves ${uci}`);
      const lines = await this.collect('d', (l) => l.startsWith('Checkers:'));
      const fenLine = lines.find((l) => l.startsWith('Fen: '));
      const checkers = lines.find((l) => l.startsWith('Checkers:'));
      return { fen: fenLine.slice(5).trim(), check: checkers.slice(9).trim() !== '' };
    });
  }

  // 둘 차례 쪽에서 본 점수. mate가 있으면 mate(수), 없으면 cp.
  async evaluate(fen, depth) {
    const [top] = await this.candidates(fen, depth, 1);
    return top ?? { score: { type: 'cp', value: 0 }, best: null };
  }

  // 후보 수 여러 개와 각 점수(둘 차례 쪽 기준), 좋은 순서. pv: 엔진이 내다본 수순(UCI)
  candidates(fen, depth, count) {
    return this.exclusive(async () => {
      this.send(`setoption name MultiPV value ${count}`);
      this.send(`position fen ${fen}`);
      const lines = await this.collect(`go depth ${depth}`, (l) => l.startsWith('bestmove'));
      const byRank = new Map();
      for (const l of lines) {
        const m = /^info .*\bscore (cp|mate) (-?\d+).*? pv (.+)$/.exec(l);
        if (!m || / (lowerbound|upperbound) /.test(l)) continue;
        const rank = Number(/\bmultipv (\d+)/.exec(l)?.[1] ?? 1);
        const pv = m[3].trim().split(/\s+/);
        byRank.set(rank, { score: { type: m[1], value: Number(m[2]) }, best: pv[0], pv });
      }
      const best = lines.at(-1).split(' ')[1];
      if (best === '(none)') return [];
      const list = [...byRank.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
      if (list[0] && list[0].best !== best) Object.assign(list[0], { best, pv: [best] });
      return list;
    });
  }

  terminate() {
    this.worker.terminate();
  }
}
