/**
 * Capacitor용 웹 빌드 스크립트
 * capture.html → www/index.html 복사 + API 경로를 Railway 서버로 변환
 */
const fs = require('fs');
const path = require('path');

const SERVER_URL = 'https://purl-production-e807.up.railway.app';
const ROOT = path.resolve(__dirname, '..');
const WWW = path.join(ROOT, 'www');

// www 폴더 생성
if (!fs.existsSync(WWW)) fs.mkdirSync(WWW, { recursive: true });

// capture.html → www/index.html (API 경로 변환)
let html = fs.readFileSync(path.join(ROOT, 'capture.html'), 'utf-8');

// API base 경로를 절대 URL로 변환
html = html.replace(
  "var API = '/api';",
  `var API = '${SERVER_URL}/api';`
);

// fetch('/api/auth/...) 같은 직접 참조도 변환
html = html.replace(
  /(['"])\/api\//g,
  `$1${SERVER_URL}/api/`
);

// manifest, sw 등 PWA 관련은 네이티브 앱에서 불필요하므로 제거
html = html.replace(/<link rel="manifest"[^>]*>/g, '');
html = html.replace(/if\s*\(\s*['"]serviceWorker['"]\s*in\s*navigator\s*\)[\s\S]*?}\s*\)\s*;?\s*/g, '');

fs.writeFileSync(path.join(WWW, 'index.html'), html, 'utf-8');

// 아이콘 복사
const ICONS_SRC = path.join(ROOT, 'icons');
const ICONS_DST = path.join(WWW, 'icons');
if (!fs.existsSync(ICONS_DST)) fs.mkdirSync(ICONS_DST, { recursive: true });

for (const file of fs.readdirSync(ICONS_SRC)) {
  fs.copyFileSync(path.join(ICONS_SRC, file), path.join(ICONS_DST, file));
}

console.log('빌드 완료: www/index.html');
console.log('API 서버:', SERVER_URL);
