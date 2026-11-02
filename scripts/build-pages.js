/* =========================================================
   옛글자 하위 페이지 생성기
   ---------------------------------------------------------
   실행:  node scripts/build-pages.js

   하는 일
   1. js/lessons.js 를 읽어 문헌마다 원문·풀이 페이지(lessons/문헌id.html)를 만든다
   2. 이용약관(terms.html) · 개인정보처리방침(privacy.html)을 만든다
   3. sitemap.xml · robots.txt 를 만든다
   4. index.html 의 사이트 주소와 바닥글 링크를 맞춘다

   ▶ 문헌을 추가했거나, 도메인을 바꿨을 때 다시 실행하세요.
   ========================================================= */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// ★ 사이트 주소: 도메인을 사면 여기만 바꾸고 다시 실행 (끝에 / 꼭 붙이기)
const SITE = 'https://yeonghoon51-max.github.io/curly-pancake/';
const SITE_NAME = '옛글자';

const ROOT = path.join(__dirname, '..', 'old-book-typing');
const CONTENT = path.join(__dirname, 'content');
const today = new Date().toISOString().slice(0, 10);

/* ---------- 문헌 데이터 읽기 ---------- */
const ctx = {};
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'js', 'lessons.js'), 'utf8') + '\nthis.__LESSONS = LESSONS;', ctx);
const LESSONS = ctx.__LESSONS;

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const fullTitle = l => l.title ? `${l.book} ${l.title}` : l.book;

/* ---------- 공통 머리말 · 바닥글 ---------- */
function footerHtml(prefix){
  const home = prefix || './';
  const lessonLinks = LESSONS.map(l => `<a href="${prefix}lessons/${l.id}.html">${esc(fullTitle(l))}</a>`).join('\n    ');
  return `<footer>
  <nav class="foot-links" aria-label="문헌">
    ${lessonLinks}
  </nav>
  <nav class="foot-links" aria-label="사이트 정보">
    <a href="${home}#library">문헌 목록</a>
    <a href="${prefix}terms.html">이용약관</a>
    <a href="${prefix}privacy.html"><strong>개인정보처리방침</strong></a>
    <a href="${home}#license">출처 및 저작권</a>
  </nav>
  옛글자 · 고서 타자연습 — 원문은 15세기 공유 저작물이며, 현대어 풀이는 이 사이트가 학습용으로 새로 쓴 글입니다.
</footer>`;
}

function page({ file, title, description, body, jsonld = [] }){
  const depth = file.split('/').length - 1;
  const prefix = depth ? '../'.repeat(depth) : '';
  const url = SITE + file;
  const home = prefix || './';
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(title)}</title>
  <meta name="description" content="${esc(description)}" />
  <link rel="canonical" href="${url}" />
  <meta name="theme-color" content="#7c3f2f" />
  <link rel="icon" href="${prefix}favicon.svg" type="image/svg+xml" />
  <link rel="icon" href="${prefix}favicon-48.png" sizes="48x48" type="image/png" />
  <link rel="apple-touch-icon" href="${prefix}apple-touch-icon.png" />
  <meta property="og:type" content="article" />
  <meta property="og:site_name" content="${SITE_NAME}" />
  <meta property="og:title" content="${esc(title)}" />
  <meta property="og:description" content="${esc(description)}" />
  <meta property="og:url" content="${url}" />
  <meta property="og:image" content="${SITE}og-image.png" />
  <meta property="og:locale" content="ko_KR" />
  <meta name="twitter:card" content="summary_large_image" />
  <link rel="preconnect" href="https://fonts.googleapis.com" />
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
  <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Noto+Serif+KR:wght@400;500;600;700;800&display=swap" />
  <link rel="stylesheet" href="${prefix}css/style.css" />
  <script>try{const s=JSON.parse(localStorage.getItem('yetgeulja.v2')||'{}').settings||{};document.documentElement.dataset.theme=(s.theme?s.theme==='dark':matchMedia('(prefers-color-scheme: dark)').matches)?'dark':'light'}catch(e){}</script>
${jsonld.map(j => `  <script type="application/ld+json">${JSON.stringify(j)}</script>`).join('\n')}
</head>
<body>
<!-- 이 파일은 scripts/build-pages.js 가 만든 것입니다. 직접 고치지 말고 스크립트나 lessons.js 를 고친 뒤 다시 실행하세요. -->
<header class="topbar">
  <a class="brand" href="${home}" style="color:inherit;text-decoration:none"><div class="seal">옛</div><span>옛글자 · 고서 타자연습</span></a>
  <nav class="topnav">
    <a href="${home}#practice">타자연습</a>
    <a href="${home}#library">문헌</a>
    <a href="${home}#records">기록</a>
    <a href="${home}#about">소개</a>
    <button class="icon-btn" id="themeBtn" type="button" aria-label="테마 바꾸기">🌙</button>
  </nav>
</header>
<main class="doc">
${body}
</main>
${footerHtml(prefix)}
<script src="${prefix}js/theme.js"></script>
</body>
</html>
`;
}

function breadcrumb(items){
  return {
    '@context':'https://schema.org', '@type':'BreadcrumbList',
    itemListElement: items.map(([name, url], i) => ({ '@type':'ListItem', position:i + 1, name, item:url }))
  };
}

/* ---------- 1. 문헌 페이지 ---------- */
fs.mkdirSync(path.join(ROOT, 'lessons'), { recursive:true });
for(const old of fs.readdirSync(path.join(ROOT, 'lessons'))) fs.unlinkSync(path.join(ROOT, 'lessons', old));

for(const l of LESSONS){
  const file = `lessons/${l.id}.html`;
  const name = fullTitle(l);
  const eonhaeLabel = (l.labels && l.labels.eonhae) || '언해본';
  const has = [l.eonhae && eonhaeLabel, l.original && '한문'].filter(Boolean);

  const verses = l.modern.map((m, i) => `
  <div class="verse">
    <div class="no">${String(i + 1).padStart(2, '0')}</div>
    <p class="modern">${esc(m)}</p>
    <dl>
      ${l.eonhae && l.eonhae[i] ? `<dt>${esc(eonhaeLabel)}</dt><dd class="eonhae">${esc(l.eonhae[i])}</dd>` : ''}
      ${l.original && l.original[i] ? `<dt>한문</dt><dd>${esc(l.original[i])}</dd>` : ''}
    </dl>
  </div>`).join('');

  const others = LESSONS.filter(o => o.id !== l.id).map(o =>
    `<li><a href="${o.id}.html">${esc(fullTitle(o))}<small>${esc(o.era || '')}</small></a></li>`).join('\n    ');

  const body = `
  <nav class="crumbs" aria-label="위치"><a href="../">옛글자</a> › <a href="../#library">문헌</a> › ${esc(l.book)}</nav>
  <h1>${esc(name)}</h1>
  <p class="lead">${esc(l.desc)}</p>
  <div class="meta">
    <span class="tag">${esc(l.era || '')}</span>
    ${has.map(h => `<span class="tag">${esc(h)} 원문</span>`).join('')}
    <span class="tag">${l.modern.join(' ').length}자</span>
  </div>
  <p><a class="cta" href="../?lesson=${encodeURIComponent(l.id)}#practice">✏️ 이 글로 세로쓰기 타자 연습하기</a></p>

  <h2>원문과 현대어 풀이</h2>
  ${verses}

  <h2>해설</h2>
  <p>${esc(l.about || '')}</p>
  <p>현대어 풀이는 이 사이트가 학습용으로 새로 풀어 쓴 글입니다. 옛한글은 방점 등을 생략해 단순화했으므로 실제 판본과 다를 수 있습니다.</p>

  <h2>다른 문헌</h2>
  <ul class="related">
    ${others}
  </ul>`;

  fs.writeFileSync(path.join(ROOT, file), page({
    file,
    title: `${name} 원문과 현대어 풀이 · 타자연습 | ${SITE_NAME}`,
    description: `${name}(${l.era}) 원문${has.length ? '(' + has.join('·') + ')' : ''}과 현대어 풀이. ${l.desc} 세로쓰기 화면에서 직접 따라 쳐 보세요.`,
    body,
    jsonld: [breadcrumb([[SITE_NAME, SITE], ['문헌', SITE + '#library'], [name, SITE + file]])]
  }));
}

/* ---------- 2. 이용약관 · 개인정보처리방침 ---------- */
const docs = [
  { file:'terms.html',   name:'이용약관',         description:'옛글자 · 고서 타자연습 서비스의 이용약관입니다.' },
  { file:'privacy.html', name:'개인정보처리방침', description:'옛글자 · 고서 타자연습은 개인정보를 수집하지 않습니다. 브라우저에 저장되는 정보와 외부 서비스를 안내합니다.' }
];
for(const d of docs){
  fs.writeFileSync(path.join(ROOT, d.file), page({
    file: d.file,
    title: `${d.name} | ${SITE_NAME}`,
    description: d.description,
    body: `  <nav class="crumbs" aria-label="위치"><a href="./">옛글자</a> › ${d.name}</nav>\n  <h1>${d.name}</h1>\n` + fs.readFileSync(path.join(CONTENT, d.file), 'utf8'),
    jsonld: [breadcrumb([[SITE_NAME, SITE], [d.name, SITE + d.file]])]
  }));
}

/* ---------- 3. sitemap.xml · robots.txt ---------- */
const urls = ['', ...LESSONS.map(l => `lessons/${l.id}.html`), 'terms.html', 'privacy.html'];
fs.writeFileSync(path.join(ROOT, 'sitemap.xml'),
`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(u => `  <url><loc>${SITE}${u}</loc><lastmod>${today}</lastmod></url>`).join('\n')}
</urlset>
`);
fs.writeFileSync(path.join(ROOT, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${SITE}sitemap.xml\n`);

/* ---------- 4. index.html 주소 · 바닥글 맞추기 ---------- */
const indexPath = path.join(ROOT, 'index.html');
let index = fs.readFileSync(indexPath, 'utf8');
const oldSite = (index.match(/<link rel="canonical" href="([^"]+)"/) || [])[1];
if(oldSite && oldSite !== SITE) index = index.split(oldSite).join(SITE);
index = index.replace(/<!-- SITE-FOOTER:START -->[\s\S]*<!-- SITE-FOOTER:END -->/,
  `<!-- SITE-FOOTER:START (scripts/build-pages.js 가 채움) -->\n${footerHtml('')}\n<!-- SITE-FOOTER:END -->`);
fs.writeFileSync(indexPath, index);

console.log(`완료: 문헌 페이지 ${LESSONS.length}개, 약관 2개, sitemap ${urls.length}개 주소 → ${SITE}`);
