// 앱 파일을 기기에 담아 두어 인터넷이 없어도 쌓인 장면을 둘 수 있게 한다.
// - 화면·코드(html, js, css, manifest): 인터넷이 되면 늘 새로 받고, 안 되면 담아 둔 것
// - 큰 파일(Stockfish, 판·기물, 아이콘): 담아 둔 것을 먼저 쓰고 뒤에서 새로 받아 둔다
// Chess.com API는 담지 않는다.
const CACHE = 'chess-replay-v2';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/app.js', 'src/analyze.js', 'src/board.js', 'src/bot.js', 'src/engine.js', 'src/library.js',
  'src/material.js', 'src/pgn.js', 'src/play.js', 'src/scenes.js', 'src/store.js',
  'stockfish/stockfish-18-lite-single.js', 'stockfish/stockfish-18-lite-single.wasm',
  'icons/icon-192.png', 'icons/icon.svg',
  // 판(cm-chessboard)
  'vendor/cm-chessboard/src/Chessboard.js',
  'vendor/cm-chessboard/src/extensions/accessibility/Accessibility.js',
  'vendor/cm-chessboard/src/extensions/accessibility/I18n.js',
  'vendor/cm-chessboard/src/extensions/arrows/Arrows.js',
  'vendor/cm-chessboard/src/extensions/auto-border-none/AutoBorderNone.js',
  'vendor/cm-chessboard/src/extensions/html-layer/HtmlLayer.js',
  'vendor/cm-chessboard/src/extensions/markers/Markers.js',
  'vendor/cm-chessboard/src/extensions/persistence/Persistence.js',
  'vendor/cm-chessboard/src/extensions/piece-rotation/PieceRotation.js',
  'vendor/cm-chessboard/src/extensions/promotion-dialog/PromotionDialog.js',
  'vendor/cm-chessboard/src/extensions/right-click-annotator/RightClickAnnotator.js',
  'vendor/cm-chessboard/src/lib/Svg.js',
  'vendor/cm-chessboard/src/lib/Utils.js',
  'vendor/cm-chessboard/src/model/ChessboardState.js',
  'vendor/cm-chessboard/src/model/Extension.js',
  'vendor/cm-chessboard/src/model/Position.js',
  'vendor/cm-chessboard/src/view/ChessboardView.js',
  'vendor/cm-chessboard/src/view/PositionAnimationsQueue.js',
  'vendor/cm-chessboard/src/view/VisualMoveInput.js',
  'vendor/cm-chessboard/assets/chessboard.css',
  'vendor/cm-chessboard/assets/extensions/arrows/arrows.css',
  'vendor/cm-chessboard/assets/extensions/arrows/arrows.svg',
  'vendor/cm-chessboard/assets/extensions/markers/markers.css',
  'vendor/cm-chessboard/assets/extensions/markers/markers.svg',
  'vendor/cm-chessboard/assets/extensions/promotion-dialog/promotion-dialog.css',
  'vendor/cm-chessboard/assets/pieces/standard.svg',
];
const HEAVY = /\/(stockfish|vendor|icons)\//;

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      });
      if (HEAVY.test(url.pathname)) {
        const cached = await cache.match(e.request, { ignoreSearch: true });
        if (cached) {
          e.waitUntil(fresh.catch(() => {}));
          return cached;
        }
        return fresh;
      }
      try {
        return await fresh;
      } catch {
        return (await cache.match(e.request, { ignoreSearch: true })) ?? Response.error();
      }
    }),
  );
});
