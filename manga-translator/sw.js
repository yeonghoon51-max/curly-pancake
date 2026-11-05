/* 오프라인에서도 앱 화면이 열리도록 기본 파일을 저장해 두는 서비스 워커.
   번역 요청(api.anthropic.com)은 저장하지 않고 항상 인터넷으로 보낸다.
   파일을 고치면 아래 VERSION 을 올려야 휴대폰에 새 버전이 들어간다. */
const VERSION = 'malpungseon-v1';
const SHELL = [
  './', 'index.html', 'css/style.css', 'js/app.js', 'js/bubble.js', 'js/translator.js',
  'js/vendor/anthropic-sdk.mjs', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (url.origin === self.location.origin) {
    // 앱 파일: 인터넷 먼저, 안 되면 저장본
    e.respondWith(fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    // 글꼴: 저장본 먼저
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(VERSION).then(c => c.put(e.request, copy));
      return res;
    })));
  }
});
