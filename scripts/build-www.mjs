// 앱(Capacitor)에 넣을 웹 파일을 www/로 모은다. 웹 버전(GitHub Pages)은 저장소 루트를 그대로 쓴다.
import { cpSync, rmSync, mkdirSync } from 'node:fs';

const FILES = ['index.html', 'background.html', 'manifest.webmanifest', 'src', 'stockfish', 'vendor', 'icons'];
rmSync('www', { recursive: true, force: true });
mkdirSync('www');
for (const f of FILES) cpSync(f, `www/${f}`, { recursive: true });
console.log('www/ 준비됨');
