// icons/icon.svg로 웹·안드로이드 아이콘과 시작 화면 그림을 만든다.
//   node scripts/make-icons.cjs   (Playwright 필요)
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(ROOT, 'icons/icon.svg'), 'utf8');
const BG = '#2f6b4f';
const inner = svg.replace(/^[\s\S]*?<rect width="512" height="512"[^>]*\/>/, '').replace(/<\/svg>\s*$/, '');
const RES = path.join(ROOT, 'android/app/src/main/res');
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

// scale: 아이콘 그림이 차지하는 비율, shape: 'square' | 'rounded' | 'circle' | 'none'(투명 배경)
function page(size, { scale = 1, shape = 'square', width = size, height = size } = {}) {
  const radius = { square: '0', rounded: '22%', circle: '50%', none: '0' }[shape];
  const bg = shape === 'none' ? 'transparent' : BG;
  const s = Math.round(Math.min(width, height) * scale);
  return `<html><body style="margin:0;background:transparent">
    <div style="width:${width}px;height:${height}px;display:flex;align-items:center;justify-content:center;background:${bg};border-radius:${radius};overflow:hidden">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${s}" height="${s}">${inner}</svg>
    </div></body></html>`;
}

async function shot(browser, file, html, width, height = width) {
  const p = await browser.newPage({ viewport: { width, height } });
  await p.setContent(html);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  await p.screenshot({ path: file, omitBackground: true });
  await p.close();
}

(async () => {
  const b = await chromium.launch();
  // 웹
  await shot(b, path.join(ROOT, 'icons/icon-192.png'), page(192, { shape: 'rounded' }), 192);
  await shot(b, path.join(ROOT, 'icons/icon-512.png'), page(512, { shape: 'rounded' }), 512);
  await shot(b, path.join(ROOT, 'icons/maskable-512.png'), page(512, { scale: 0.8 }), 512);
  await shot(b, path.join(ROOT, 'icons/apple-touch-icon.png'), page(180), 180);
  // 안드로이드 런처
  for (const [d, k] of Object.entries(DENSITY)) {
    const legacy = Math.round(48 * k);
    const fg = Math.round(108 * k);
    await shot(b, `${RES}/mipmap-${d}/ic_launcher.png`, page(legacy, { shape: 'rounded' }), legacy);
    await shot(b, `${RES}/mipmap-${d}/ic_launcher_round.png`, page(legacy, { shape: 'circle' }), legacy);
    // 적응형 아이콘: 108dp 중 가운데 72dp만 늘 보인다
    await shot(b, `${RES}/mipmap-${d}/ic_launcher_foreground.png`, page(fg, { shape: 'none', scale: 0.62 }), fg);
  }
  // 시작 화면: 기존 파일 크기를 그대로 쓴다
  for (const dir of fs.readdirSync(RES).filter((x) => x.startsWith('drawable'))) {
    const file = `${RES}/${dir}/splash.png`;
    if (!fs.existsSync(file)) continue;
    const buf = fs.readFileSync(file);
    const w = buf.readUInt32BE(16);
    const h = buf.readUInt32BE(20);
    await shot(b, file, page(w, { width: w, height: h, scale: 0.28 }), w, h);
  }
  await b.close();
  console.log('아이콘 만듦');
})();
