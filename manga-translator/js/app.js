/* =========================================================
   말풍선 · 만화 번역기 — 화면 동작
   - 페이지(이미지) 올리기, 페이지 넘기기
   - 번역하기 / 전체 번역 / 영역 직접 고르기 / 다시 번역
   - 말풍선 상자 옮기기·크기 바꾸기, 번역 고치기
   - 번역된 이미지 저장, 설정 저장
   ========================================================= */
import { analyzeRegion, paintRegion, drawText } from './bubble.js';
import { translateImage, encodeForClaude, MODELS, LANGS } from './translator.js';

const STORE = 'malpungseon.v1';
// 백만 토큰당 가격 (USD) — 입력, 출력
const PRICES = { 'claude-opus-5-5': [4, 20], 'claude-sonnet-5-5': [2, 10], 'claude-haiku-5-5': [0.1, 0.5] };
const FONTS = {
  gothic:  { family: '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif', weight: 700 },
  dohyeon: { family: '"Do Hyeon", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif', weight: 400 },
  hand:    { family: '"Gaegu", "Noto Sans KR", "Apple SD Gothic Neo", sans-serif', weight: 700 },
};
const KIND = { speech: '대사', thought: '생각', narration: '해설', sfx: '효과음', sign: '글씨', other: '기타' };
const MAX_EDGE = 3200;   // 너무 큰 이미지는 이 크기로 줄여서 다룬다 (휴대폰 메모리 보호)

const $ = id => document.getElementById(id);
const el = (tag, props = {}, ...kids) => {
  const e = Object.assign(document.createElement(tag), props);
  for (const k of kids) e.append(k);
  return e;
};

/* ---------- 설정 ---------- */
const defaults = { apiKey: '', model: MODELS[0].id, effort: 'medium', source: 'auto', target: 'ko',
                   font: 'gothic', scale: 1, glossary: '', theme: null };
const settings = { ...defaults, ...loadStore() };
function loadStore() { try { return JSON.parse(localStorage.getItem(STORE) || '{}'); } catch { return {}; } }
function saveStore() { try { localStorage.setItem(STORE, JSON.stringify(settings)); } catch { /* 사생활 보호 모드 등 */ } }

/* ---------- 상태 ---------- */
const state = {
  pages: [],          // {id, name, bitmap, w, h, thumb, regions[], status, error, pixels}
  cur: 0,
  sel: null,          // 선택한 영역 id
  showOriginal: false,
  showBoxes: true,
  adding: false,
  abort: null,        // 진행 중인 요청 취소용 AbortController
};
let uid = 0;
const page = () => state.pages[state.cur];

/* =========================================================
   이미지 올리기
   ========================================================= */
async function addFiles(fileList) {
  const files = [...fileList].filter(f => f.type.startsWith('image/'));
  if (!files.length) return toast('이미지 파일만 올릴 수 있어요.');
  // 파일 이름 순서대로 (001.jpg, 002.jpg …)
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const first = state.pages.length;
  for (const f of files) {
    try {
      let bmp = await createImageBitmap(f);
      const long = Math.max(bmp.width, bmp.height);
      if (long > MAX_EDGE) {
        const s = MAX_EDGE / long;
        const small = await createImageBitmap(bmp, { resizeWidth: Math.round(bmp.width * s), resizeHeight: Math.round(bmp.height * s), resizeQuality: 'high' });
        bmp.close(); bmp = small;
      }
      state.pages.push({ id: ++uid, name: f.name.replace(/\.[^.]+$/, '') || `page-${uid}`, bitmap: bmp, w: bmp.width, h: bmp.height,
                         thumb: URL.createObjectURL(f), regions: [], status: 'new', error: '', pixels: null });
    } catch {
      toast(`"${f.name}" 을(를) 열지 못했어요.`);
    }
  }
  if (state.pages.length > first) goTo(first);
}

/* =========================================================
   그리기
   ========================================================= */
function pixelsOf(p) {
  if (!p.pixels) {
    const c = new OffscreenCanvas(p.w, p.h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(p.bitmap, 0, 0);
    p.pixels = x.getImageData(0, 0, p.w, p.h);
  }
  return p.pixels;
}
function geom(p, r) {
  if (!r._geom) r._geom = analyzeRegion(pixelsOf(p), r.box, r.mode);
  return r._geom;
}

/** 페이지를 ctx 에 그린다. original 이면 번역 없이 원본만 */
function paintPage(ctx, p, original = false) {
  ctx.drawImage(p.bitmap, 0, 0);
  if (original) return;
  const f = FONTS[settings.font] || FONTS.gothic;
  for (const r of p.regions) {
    if (!r.translation || r.status === 'pending') continue;
    const g = geom(p, r);
    paintRegion(ctx, g, r.kind);
    drawText(ctx, g, r.translation, { font: f.family, weight: f.weight, scale: settings.scale * r.scale, outline: r.kind === 'sfx' && r.mode !== 'auto' });
  }
}

const canvas = $('canvas');
const ctx = canvas.getContext('2d');
let drawQueued = false;
function drawCanvas() {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    const p = page();
    if (!p) return;
    if (canvas.width !== p.w || canvas.height !== p.h) { canvas.width = p.w; canvas.height = p.h; }
    paintPage(ctx, p, state.showOriginal);
  });
}

function render() {
  const has = state.pages.length > 0;
  $('empty').hidden = has;
  $('work').hidden = !has;
  $('keyNotice').hidden = !!settings.apiKey;
  if (!has) return;
  drawCanvas();
  renderOverlay();
  renderPanel();
  renderStrip();
  renderToolbar();
}

function renderToolbar() {
  const p = page(), busy = !!state.abort;
  $('pageNo').textContent = `${state.cur + 1} / ${state.pages.length}`;
  $('prevBtn').disabled = state.cur === 0;
  $('nextBtn').disabled = state.cur >= state.pages.length - 1;
  $('translateBtn').disabled = busy;
  $('translateBtn').textContent = p.regions.length ? '다시 번역' : '번역하기';
  $('translateAllBtn').disabled = busy || state.pages.every(q => q.status === 'done');
  $('translateAllBtn').hidden = state.pages.length < 2;
  $('stopBtn').hidden = !busy;
  $('origBtn').setAttribute('aria-pressed', state.showOriginal);
  $('boxesBtn').setAttribute('aria-pressed', state.showBoxes);
  $('addBtn').setAttribute('aria-pressed', state.adding);
  $('stage').classList.toggle('adding', state.adding);
  $('busy').hidden = p.status !== 'working';
  const st = $('status');
  st.classList.toggle('err', p.status === 'error');
  st.textContent = p.status === 'error' ? '⚠️ ' + p.error : (p.note || '');
}

/* 그림 위 말풍선 상자들 (위치는 % 라서 화면 크기가 바뀌어도 맞음) */
function renderOverlay() {
  const p = page(), ov = $('overlay');
  ov.classList.toggle('hide-boxes', !state.showBoxes);
  ov.replaceChildren(...p.regions.map((r, i) => {
    const b = el('div', { className: 'rbox' + (r.id === state.sel ? ' sel' : '') + (r.status === 'pending' ? ' pending' : '') + (r.status === 'error' ? ' err' : '') });
    b.dataset.id = r.id;
    Object.assign(b.style, { left: pct(r.box.x / p.w), top: pct(r.box.y / p.h), width: pct(r.box.w / p.w), height: pct(r.box.h / p.h) });
    b.append(el('span', { className: 'rnum', textContent: i + 1 }), el('span', { className: 'handle' }));
    return b;
  }));
}
const pct = v => (v * 100).toFixed(3) + '%';

/* 오른쪽(휴대폰은 아래) 대사 목록 */
function renderPanel() {
  const p = page(), list = $('regions');
  $('count').textContent = p.regions.length;
  $('panelEmpty').hidden = p.regions.length > 0;
  list.replaceChildren(...p.regions.map((r, i) => {
    const li = el('li', { className: 'region' + (r.id === state.sel ? ' sel' : '') });
    li.dataset.id = r.id;
    const top = el('div', { className: 'region-top' },
      el('span', { className: 'n', textContent: `${i + 1}` }),
      el('span', { className: 'tag', textContent: KIND[r.kind] || '기타' }),
      r.speaker ? el('span', { textContent: r.speaker }) : '');
    const orig = el('div', { className: 'orig', textContent: r.status === 'pending' ? '읽는 중…' : (r.original || '—'), title: '원문' });
    const ta = el('textarea', { value: r.translation, rows: 2, placeholder: r.status === 'pending' ? '번역하는 중…' : '번역을 적어 주세요' });
    ta.setAttribute('aria-label', `${i + 1}번 번역`);
    ta.addEventListener('input', () => { r.translation = ta.value; drawCanvas(); });
    ta.addEventListener('focus', () => select(r.id, { fromPanel: true }));

    const mode = el('select', { title: '원래 글자 지우는 방법' });
    for (const [v, t] of [['auto', '말풍선 맞춤'], ['box', '상자로 덮기'], ['none', '지우지 않음']]) mode.append(el('option', { value: v, textContent: t }));
    mode.value = r.mode;
    mode.addEventListener('change', () => { r.mode = mode.value; r._geom = null; drawCanvas(); });

    const tools = el('div', { className: 'region-tools' }, mode,
      btn('가−', '글자 작게', () => { r.scale = Math.max(0.6, +(r.scale - 0.1).toFixed(2)); drawCanvas(); }),
      btn('가+', '글자 크게', () => { r.scale = Math.min(1.6, +(r.scale + 0.1).toFixed(2)); drawCanvas(); }),
      el('span', { className: 'spacer' }),
      btn('↻ 다시', '이 영역만 다시 번역', () => translateRegion(p, r), !!state.abort || r.status === 'pending'),
      btn('🗑', '이 영역 지우기', () => removeRegion(r.id)));
    li.append(top, orig, ta, tools);
    if (r.status === 'error') li.append(el('div', { className: 'err-msg', textContent: '⚠️ ' + r.error }));
    li.addEventListener('click', e => { if (e.target === li || e.target === orig || e.target.closest('.region-top')) select(r.id, { fromPanel: true }); });
    return li;
  }));
}
function btn(text, title, onClick, disabled = false) {
  const b = el('button', { type: 'button', className: 'btn small ghost', textContent: text, title, disabled });
  b.setAttribute('aria-label', title);
  b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
  return b;
}

/* 아래 페이지 띠 */
function renderStrip() {
  const badge = { new: '', working: '⏳', done: '✓', error: '!' };
  $('strip').replaceChildren(...state.pages.map((p, i) => {
    const t = el('button', { type: 'button', className: 'thumb' + (i === state.cur ? ' cur' : ''), title: p.name });
    t.setAttribute('aria-label', `${i + 1}쪽 ${p.name}`);
    t.append(el('img', { src: p.thumb, alt: '', loading: 'lazy' }), el('span', { className: 'pn', textContent: i + 1 }));
    if (badge[p.status]) t.append(el('span', { className: 'badge', textContent: badge[p.status] }));
    t.addEventListener('click', () => goTo(i));
    return t;
  }));
  $('strip').children[state.cur]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function goTo(i) {
  if (i < 0 || i >= state.pages.length) return;
  const old = page();
  if (old && state.cur !== i) old.pixels = null;   // 다른 페이지 픽셀은 메모리에서 비움
  state.cur = i; state.sel = null;
  render();
}

function select(id, { fromPanel = false } = {}) {
  if (state.sel === id) return;
  state.sel = id;
  for (const b of $('overlay').children) b.classList.toggle('sel', +b.dataset.id === id);
  for (const li of $('regions').children) li.classList.toggle('sel', +li.dataset.id === id);
  if (!fromPanel && id != null) $('regions').querySelector(`[data-id="${id}"]`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function removeRegion(id) {
  const p = page();
  p.regions = p.regions.filter(r => r.id !== id);
  if (state.sel === id) state.sel = null;
  render();
}

/* =========================================================
   번역
   ========================================================= */
function needKey() {
  if (settings.apiKey) return false;
  toast('먼저 설정에서 API 키를 넣어 주세요.');
  openSettings();
  return true;
}

function costOf(usage, model) {
  const [pin, pout] = PRICES[model] || PRICES['claude-opus-5-5'];
  const input = (usage.input_tokens || 0) + (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0);
  return { input, output: usage.output_tokens || 0, usd: (input * pin + (usage.output_tokens || 0) * pout) / 1e6 };
}
const usd = v => v < 0.01 ? '$' + v.toFixed(4) : '$' + v.toFixed(3);

async function translatePage(p, signal) {
  p.status = 'working'; p.error = ''; p.note = '';
  if (p === page()) render(); else renderStrip();
  try {
    const img = await encodeForClaude(p.bitmap);
    const prev = state.pages[state.pages.indexOf(p) - 1];
    const res = await translateImage({
      apiKey: settings.apiKey, model: settings.model, effort: settings.effort,
      image: img, source: settings.source, target: settings.target, glossary: settings.glossary,
      context: prev?.regions.filter(r => r.translation).map(r => ({ original: r.original, translation: r.translation })),
      signal,
    });
    const k = 1 / img.scale;
    p.regions = res.regions.map(r => ({
      id: ++uid, kind: r.kind, speaker: r.speaker, original: r.original, translation: r.translation,
      box: { x: r.box.x * k, y: r.box.y * k, w: r.box.w * k, h: r.box.h * k },
      mode: r.kind === 'sfx' ? 'box' : 'auto', scale: 1, status: 'ok', _geom: null,
    }));
    const c = costOf(res.usage, settings.model);
    p.status = 'done';
    p.note = p.regions.length
      ? `번역 완료 · 대사 ${p.regions.length}개 · 약 ${usd(c.usd)} (입력 ${c.input.toLocaleString()} / 출력 ${c.output.toLocaleString()} 토큰)`
      : `글자를 찾지 못했어요. ＋ 영역 으로 직접 골라 보세요. (약 ${usd(c.usd)})`;
  } catch (e) {
    p.status = signal?.aborted ? (p.regions.length ? 'done' : 'new') : 'error';
    p.error = e.message;
    if (signal?.aborted) p.note = '취소했어요.';
  }
  if (p === page()) render(); else renderStrip();
}

async function runTranslate(pages) {
  if (needKey() || state.abort) return;
  const ac = state.abort = new AbortController();
  renderToolbar();
  try {
    for (const p of pages) {
      if (ac.signal.aborted) break;
      if (pages.length > 1) goTo(state.pages.indexOf(p));
      await translatePage(p, ac.signal);
      if (p.status === 'error' && pages.length > 1) { toast(`${state.pages.indexOf(p) + 1}쪽에서 멈췄어요: ${p.error}`); break; }
    }
  } finally {
    state.abort = null;
    render();
  }
}

/* 영역 하나만 번역 (직접 고른 영역, 또는 다시 번역) */
async function translateRegion(p, r) {
  if (needKey() || state.abort) return;
  const ac = state.abort = new AbortController();
  r.status = 'pending'; r.error = '';
  render();
  try {
    const pad = Math.max(r.box.w, r.box.h) * 0.08;
    const crop = clampBox({ x: r.box.x - pad, y: r.box.y - pad, w: r.box.w + pad * 2, h: r.box.h + pad * 2 }, p);
    const img = await encodeForClaude(p.bitmap, crop);
    const res = await translateImage({
      apiKey: settings.apiKey, model: settings.model, effort: settings.effort, image: img, single: true,
      source: settings.source, target: settings.target, glossary: settings.glossary,
      context: p.regions.filter(q => q !== r && q.translation).map(q => ({ original: q.original, translation: q.translation })),
      signal: ac.signal,
    });
    if (!res.regions.length) throw new Error('이 영역에서 글자를 찾지 못했어요.');
    r.original = res.regions.map(q => q.original).join(' ');
    r.translation = res.regions.map(q => q.translation).join(' ');
    r.kind = res.regions[0].kind; r.speaker = res.regions[0].speaker || r.speaker;
    r.status = 'ok'; r._geom = null;
    const c = costOf(res.usage, settings.model);
    p.note = `영역 번역 완료 · 약 ${usd(c.usd)}`;
  } catch (e) {
    r.status = 'error'; r.error = e.message;
  } finally {
    state.abort = null;
    render();
  }
}

function clampBox(b, p) {
  const x = Math.max(0, b.x), y = Math.max(0, b.y);
  return { x, y, w: Math.min(p.w, b.x + b.w) - x, h: Math.min(p.h, b.y + b.h) - y };
}

/* =========================================================
   그림 위에서 끌기: 영역 추가 / 상자 옮기기 / 크기 바꾸기
   ========================================================= */
const stage = $('stage');
function toImage(e) {
  const rc = canvas.getBoundingClientRect(), p = page();
  return { x: (e.clientX - rc.left) / rc.width * p.w, y: (e.clientY - rc.top) / rc.height * p.h };
}

let drag = null;   // {type:'add'|'move'|'resize', start, r, orig, draft}
let skipClick = false;   // 끌기가 끝난 직후의 click 은 무시
stage.addEventListener('pointerdown', e => {
  const p = page();
  if (!p || e.button > 0) return;
  const boxEl = e.target.closest('.rbox');
  const start = toImage(e);
  if (state.adding) {
    const draft = el('div', { className: 'draft' });
    $('overlay').append(draft);
    drag = { type: 'add', start, draft };
  } else if (boxEl && +boxEl.dataset.id === state.sel) {
    const r = p.regions.find(q => q.id === state.sel);
    drag = { type: e.target.classList.contains('handle') ? 'resize' : 'move', start, r, orig: { ...r.box }, moved: false };
  } else {
    return;   // 일반 누르기는 click 에서 처리 (스크롤 방해 안 함)
  }
  stage.setPointerCapture(e.pointerId);
  e.preventDefault();
});
stage.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = page(), cur = toImage(e);
  const dx = cur.x - drag.start.x, dy = cur.y - drag.start.y;
  if (drag.type === 'add') {
    const b = normBox(drag.start, cur);
    Object.assign(drag.draft.style, { left: pct(b.x / p.w), top: pct(b.y / p.h), width: pct(b.w / p.w), height: pct(b.h / p.h) });
    drag.box = b;
    return;
  }
  const o = drag.orig, r = drag.r;
  if (drag.type === 'move') r.box = clampBox({ x: Math.min(Math.max(0, o.x + dx), p.w - o.w), y: Math.min(Math.max(0, o.y + dy), p.h - o.h), w: o.w, h: o.h }, p);
  else r.box = clampBox({ x: o.x, y: o.y, w: Math.max(12, o.w + dx), h: Math.max(12, o.h + dy) }, p);
  drag.moved = true;
  r._geom = null;
  const b = $('overlay').querySelector(`[data-id="${r.id}"]`);
  Object.assign(b.style, { left: pct(r.box.x / p.w), top: pct(r.box.y / p.h), width: pct(r.box.w / p.w), height: pct(r.box.h / p.h) });
  drawCanvas();
});
const endDrag = () => {
  if (!drag) return;
  const d = drag; drag = null;
  skipClick = d.type === 'add' || d.moved;
  if (d.type === 'add') {
    d.draft.remove();
    const p = page();
    if (d.box && d.box.w > p.w * 0.015 && d.box.h > p.h * 0.01) {
      const r = { id: ++uid, kind: 'speech', speaker: '', original: '', translation: '', box: d.box, mode: 'auto', scale: 1, status: 'pending', _geom: null };
      p.regions.push(r);
      state.sel = r.id;
      state.adding = false;
      translateRegion(p, r);
    }
  }
};
stage.addEventListener('pointerup', endDrag);
stage.addEventListener('pointercancel', endDrag);
stage.addEventListener('click', e => {
  if (skipClick) { skipClick = false; return; }
  if (state.adding) return;
  const b = e.target.closest('.rbox');
  select(b ? +b.dataset.id : null);
});
const normBox = (a, b) => ({ x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) });

/* =========================================================
   저장
   ========================================================= */
async function exportPage(p) {
  const c = new OffscreenCanvas(p.w, p.h);
  paintPage(c.getContext('2d'), p, false);
  const blob = await c.convertToBlob({ type: 'image/png' });
  const name = `${p.name}-${settings.target}.png`;
  // 휴대폰은 공유 시트로 "사진에 저장" 할 수 있게
  const file = new File([blob], name, { type: 'image/png' });
  if (matchMedia('(pointer:coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file] }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
async function exportAll() {
  for (const p of state.pages) {
    const keep = p.pixels;
    await exportPage(p);
    if (p !== page() && !keep) p.pixels = null;
    await new Promise(r => setTimeout(r, 350));   // 브라우저가 연속 다운로드를 막지 않도록
  }
}

/* =========================================================
   설정 창
   ========================================================= */
const dlg = $('settings');
for (const m of MODELS) $('model').append(el('option', { value: m.id, textContent: m.label }));
for (const [v, t] of Object.entries(LANGS)) $('source').append(el('option', { value: v, textContent: t }));
for (const [v, t] of Object.entries(LANGS)) if (v !== 'auto') $('target').append(el('option', { value: v, textContent: t }));

function openSettings() {
  $('apiKey').value = settings.apiKey;
  for (const k of ['model', 'effort', 'source', 'target', 'font', 'glossary']) $(k).value = settings[k];
  $('scale').value = settings.scale;
  $('scaleOut').textContent = Math.round(settings.scale * 100) + '%';
  dlg.showModal();
}
$('scale').addEventListener('input', () => {
  settings.scale = +$('scale').value;
  $('scaleOut').textContent = Math.round(settings.scale * 100) + '%';
  drawCanvas();
});
$('font').addEventListener('change', async () => { settings.font = $('font').value; await loadFont(); drawCanvas(); });
$('toggleKey').addEventListener('click', () => { const i = $('apiKey'); i.type = i.type === 'password' ? 'text' : 'password'; });
$('clearKey').addEventListener('click', () => { $('apiKey').value = ''; settings.apiKey = ''; saveStore(); toast('API 키를 지웠어요.'); render(); });
dlg.addEventListener('close', () => {
  if (dlg.returnValue === 'ok') {
    settings.apiKey = $('apiKey').value.trim();
    for (const k of ['model', 'effort', 'source', 'target', 'font']) settings[k] = $(k).value;
    settings.glossary = $('glossary').value;
    toast('설정을 저장했어요.');
  }
  settings.scale = +$('scale').value;
  saveStore();
  render();
});
document.addEventListener('click', e => { if (e.target.closest('[data-open-settings]')) openSettings(); });

/* =========================================================
   버튼·단축키·끌어다 놓기
   ========================================================= */
$('settingsBtn').addEventListener('click', openSettings);
$('fileInput').addEventListener('change', e => { addFiles(e.target.files); e.target.value = ''; });
$('prevBtn').addEventListener('click', () => goTo(state.cur - 1));
$('nextBtn').addEventListener('click', () => goTo(state.cur + 1));
$('translateBtn').addEventListener('click', () => {
  const p = page();
  if (p.regions.some(r => r.translation) && !confirm('이 페이지를 처음부터 다시 번역할까요? 고친 번역은 없어져요.')) return;
  runTranslate([p]);
});
$('translateAllBtn').addEventListener('click', () => runTranslate(state.pages.filter(p => p.status !== 'done')));
$('stopBtn').addEventListener('click', () => state.abort?.abort());
$('addBtn').addEventListener('click', () => {
  state.adding = !state.adding;
  if (state.adding) { select(null); toast('번역할 곳을 손가락이나 마우스로 끌어서 네모를 그리세요.'); }
  renderToolbar();
});
$('origBtn').addEventListener('click', () => { state.showOriginal = !state.showOriginal; renderToolbar(); drawCanvas(); });
$('boxesBtn').addEventListener('click', () => { state.showBoxes = !state.showBoxes; renderToolbar(); renderOverlay(); });
$('saveBtn').addEventListener('click', () => exportPage(page()));

const menu = $('moreMenu');
$('moreBtn').addEventListener('click', e => { e.stopPropagation(); menu.hidden = !menu.hidden; $('moreBtn').setAttribute('aria-expanded', !menu.hidden); });
document.addEventListener('click', () => { if (!menu.hidden) { menu.hidden = true; $('moreBtn').setAttribute('aria-expanded', 'false'); } });
$('saveAllBtn').addEventListener('click', exportAll);
$('addPagesBtn').addEventListener('click', () => $('fileInput').click());
$('clearRegionsBtn').addEventListener('click', () => { const p = page(); p.regions = []; p.status = 'new'; p.note = ''; state.sel = null; render(); });
$('removePageBtn').addEventListener('click', () => {
  const p = page();
  p.bitmap.close(); URL.revokeObjectURL(p.thumb);
  state.pages.splice(state.cur, 1);
  state.cur = Math.min(state.cur, state.pages.length - 1);
  render();
});
$('closeAllBtn').addEventListener('click', () => {
  if (!confirm('모든 페이지를 닫을까요? 저장하지 않은 번역은 없어져요.')) return;
  state.abort?.abort();
  for (const p of state.pages) { p.bitmap.close(); URL.revokeObjectURL(p.thumb); }
  state.pages = []; state.cur = 0;
  render();
});

$('themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme !== 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  settings.theme = dark ? 'dark' : 'light';
  $('themeBtn').textContent = dark ? '☀️' : '🌙';
  saveStore();
});
$('themeBtn').textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';

document.addEventListener('keydown', e => {
  if (e.target.closest('input, textarea, select, dialog') || !state.pages.length) return;
  if (e.key === 'ArrowLeft') goTo(state.cur - 1);
  else if (e.key === 'ArrowRight') goTo(state.cur + 1);
  else if (e.key === 'o' || e.key === 'O') $('origBtn').click();
  else if ((e.key === 'Delete' || e.key === 'Backspace') && state.sel != null) removeRegion(state.sel);
  else if (e.key === 'Escape') { state.adding = false; select(null); renderToolbar(); }
  else return;
  e.preventDefault();
});

// 끌어다 놓기 · 붙여 넣기
const drop = $('drop');
document.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
document.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer?.files.length) addFiles(e.dataTransfer.files); });
document.addEventListener('paste', e => {
  if (e.target.closest('input, textarea')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});
window.addEventListener('beforeunload', e => { if (state.pages.some(p => p.regions.length)) e.preventDefault(); });

/* ---------- 알림 ---------- */
let toastTimer;
function toast(msg) {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
}

/* ---------- 글꼴: 캔버스는 글꼴이 다 받아진 뒤에 그려야 제대로 나온다 ---------- */
async function loadFont() {
  const f = FONTS[settings.font] || FONTS.gothic;
  const name = f.family.split(',')[0];
  try { await document.fonts.load(`${f.weight} 32px ${name}`, '가나다'); } catch { /* 오프라인이면 기본 글꼴 */ }
}
document.fonts?.addEventListener?.('loadingdone', drawCanvas);
loadFont().then(drawCanvas);

/* ---------- 앱처럼 설치 (오프라인에서도 화면은 열림) ---------- */
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// 테스트·디버깅용 (개발자 도구에서 window.__manga 로 살펴볼 수 있음)
window.__manga = { state, settings, addFiles, render };

render();
