// IndexedDB에 게임, 장면, 결과를 둔다. 서버 없음.

const NAME = 'chess-replay';
let dbPromise = null;

function open() {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      db.createObjectStore('games', { keyPath: 'url' });
      db.createObjectStore('scenes', { keyPath: 'id' });
      db.createObjectStore('results', { autoIncrement: true });
      db.createObjectStore('meta');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

async function tx(store, mode, fn) {
  const db = await open();
  const t = db.transaction(store, mode);
  const finished = new Promise((resolve, reject) => {
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  const result = await fn(t.objectStore(store));
  await finished;
  return result;
}

export const getAll = (store) => tx(store, 'readonly', (s) => done(s.getAll()));
export const get = (store, key) => tx(store, 'readonly', (s) => done(s.get(key)));
export const put = (store, value, key) => tx(store, 'readwrite', (s) => done(key === undefined ? s.put(value) : s.put(value, key)));
export const putMany = (store, values) => tx(store, 'readwrite', (s) => Promise.all(values.map((v) => done(s.put(v)))));
export const add = (store, value) => tx(store, 'readwrite', (s) => done(s.add(value)));
export const del = (store, key) => tx(store, 'readwrite', (s) => done(s.delete(key)));

// 아이디를 바꾸면 이전 아이디의 기록은 지운다.
export async function clearAll() {
  for (const store of ['games', 'scenes', 'results', 'meta']) await tx(store, 'readwrite', (s) => done(s.clear()));
}
