// 앱 파일을 기기에 담아 두어 빨리 열리고, 인터넷이 없어도 쌓인 장면을 둘 수 있게 한다.
// 같은 출처의 파일은 담아 둔 것을 먼저 쓰고 뒤에서 새로 받아 둔다(다음에 열 때 반영).
// Chess.com API는 담지 않는다.
const CACHE = 'chess-replay-v1';
const SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/app.js', 'src/analyze.js', 'src/board.js', 'src/bot.js', 'src/engine.js', 'src/library.js', 'src/pgn.js', 'src/play.js', 'src/scenes.js', 'src/store.js',
  'stockfish/stockfish-18-lite-single.js', 'stockfish/stockfish-18-lite-single.wasm',
  'icons/icon-192.png',
];

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
      const cached = await cache.match(e.request, { ignoreSearch: true });
      const fresh = fetch(e.request).then((res) => {
        if (res.ok) cache.put(e.request, res.clone());
        return res;
      });
      if (cached) {
        e.waitUntil(fresh.catch(() => {}));
        return cached;
      }
      return fresh;
    }),
  );
});
