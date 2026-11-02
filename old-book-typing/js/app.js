'use strict';
/* =========================================================
   옛글자 · 고서 타자연습 — 동작
   1. 저장소 (설정 · 기록 · 내 글)
   2. 상태와 시계
   3. 효과음
   4. 화면 그리기 (세로 열 · 곁글 · 안내줄)
   5. 입력 판정
   6. 결과창과 기록
   7. 문헌 목록 · 내 글 넣기
   8. 설정 (테마 · 글자 크기 · 안내줄 · 효과음)
   9. 이벤트 연결
   ========================================================= */

const $ = id => document.getElementById(id);
const COL_MAX = 12;          // 세로 한 줄 최대 글자 수 (style.css 의 --text-h 계산과 짝)
const SIZES = { s:'18px', m:'22px', l:'26px' };
const NAV_KEYS = ['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown','Tab','Enter'];
const PUNCT = /[.,!?;:]/;
const PUNCT_NAME = {' ':'띄어쓰기', ',':'쉼표(,)', '.':'마침표(.)', '?':'물음표(?)', '!':'느낌표(!)'};

const columns = $('columns');
const typing  = $('typing');
const stage   = $('verticalStage');
const hint    = $('typeHint');

/* ---------------- 1. 저장소 ---------------- */
// localStorage 는 시크릿 창 등에서 막힐 수 있으므로 항상 try/catch 로 감싼다.
const STORE_KEY = 'yetgeulja.v2';
const store = (() => {
  let data = {};
  try{ data = JSON.parse(localStorage.getItem(STORE_KEY) || '{}') || {}; }catch(e){}
  if(!Array.isArray(data.records)) data.records = [];
  if(!Array.isArray(data.custom))  data.custom = [];
  data.settings = Object.assign({ theme:null, size:'m', sound:true, guide:true, gloss:'eonhae', lastId:null }, data.settings);
  return {
    data,
    save(){ try{ localStorage.setItem(STORE_KEY, JSON.stringify(data)); }catch(e){} }
  };
})();
const settings = store.data.settings;

const allLessons = () => [...LESSONS, ...store.data.custom];
const curLesson  = () => allLessons()[state.idx];
const bestOf = id => store.data.records.reduce((m, r) => r.id === id ? Math.max(m, r.cpm) : m, 0);

/* ---------------- 2. 상태와 시계 ---------------- */
const state = {
  idx: 0,
  gloss: 'eonhae',     // 지금 화면에 쓰는 곁글 (문헌에 없으면 다른 것으로 대체)
  target: [],          // 쳐야 할 전체 글자 (code point 배열)
  ranges: [],          // 문장별 [시작, 끝) 위치
  cols: [], spans: [],
  composing: false,
  completed: false,
  clockMs: 0,          // 멈춘 동안을 뺀 누적 시간
  runSince: 0,         // 지금 달리는 중이면 시작 시각
  judged: 0,           // 오타 누적 집계를 마친 위치
  mistakes: 0,         // 고친 것까지 포함한 누적 오타
  misses: {},          // 원래 글자별 틀린 횟수
  prevWrong: 0,
  samples: [],         // 결과 그래프용 [{t:초, cpm}]
  live: { pos:0, correct:0, committed:0, wrong:0 }
};

const elapsedMs = () => state.clockMs + (state.runSince ? Date.now() - state.runSince : 0);
function resumeClock(){ if(!state.runSince && !state.completed) state.runSince = Date.now(); }
function pauseClock(){
  if(state.runSince){ state.clockMs += Date.now() - state.runSince; state.runSince = 0; }
}
function fmtTime(sec){
  return String(Math.floor(sec/60)).padStart(2,'0') + ':' + String(sec % 60).padStart(2,'0');
}
// 자모 입력 수 기준 분당 타수. 처음 1.5초는 값이 튀므로 0으로 둔다.
function currentCpm(){
  const ms = elapsedMs();
  return ms < 1500 ? 0 : Math.round(Hangul.keystrokes(typing.value) / (ms / 60000));
}

/* ---------------- 3. 효과음 ---------------- */
let audioCtx = null;
function beep(freq, dur, type = 'sine', vol = .04){
  if(!settings.sound) return;
  try{
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if(audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
    osc.type = type; osc.frequency.value = freq; gain.gain.value = vol;
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + dur);
    osc.stop(audioCtx.currentTime + dur);
  }catch(e){}
}
const playClick    = () => beep(720, .028, 'square', .035);
const playWrong    = () => beep(170, .09, 'sawtooth', .05);
const playComplete = () => [523, 659, 784].forEach((f, i) => setTimeout(() => beep(f, i === 2 ? .2 : .12, 'sine', .055), i * 110));

/* ---------------- 4. 화면 그리기 ---------------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const clean = s => String(s || '').replace(/\s+/g, ' ').trim();

// 세로 한 줄(열)에 들어갈 만큼 자른다. 어절(띄어쓰기 단위)은 중간에서 자르지 않는다.
// 어절 끝 띄어쓰기는 열 끝에 매달리고, 마침표·쉼표는 어절에 붙어 혼자 한 줄을 차지하지 않는다.
function splitVertical(text, size = COL_MAX){
  const words = text.match(/\S+\s*/g) || [];
  const cols = [];
  let line = '';
  for(const w of words){
    const wordLen = [...w.trimEnd()].length;
    if(line && [...line].length + wordLen > size){ cols.push(line); line = ''; }
    if(!line && wordLen > size){                 // 한 어절이 한 열보다 길면 어쩔 수 없이 자른다
      const cs = [...w];
      while(cs.length > size + 1) cols.push(cs.splice(0, size).join(''));
      line = cs.join('');
      continue;
    }
    line += w;
  }
  if(line) cols.push(line);
  return cols;
}

function spanHtml(c){
  return `<span${c === ' ' ? ' class="sp"' : ''} data-c="${esc(c)}"${PUNCT.test(c) ? ' data-pn="1"' : ''}>${esc(c)}</span>`;
}

// 각 열은 위에서 아래로 읽고, 다음 열은 오른쪽에서 왼쪽으로 이어진다.
// 문장 사이 띄어쓰기는 그 문장 마지막 열 끝에 붙어서, 화면 글자 순서와 target 순서가 같다.
const PER_HALF = 6;          // 반엽(반쪽) 하나에 들어가는 줄 수
const HANJA_NUM = ['','一','二','三','四','五','六','七','八','九','十'];
const hanjaNum = n => n <= 10 ? HANJA_NUM[n] : (n >= 20 ? HANJA_NUM[Math.floor(n / 10)] : '') + '十' + HANJA_NUM[n % 10];

function buildColumns(l){
  const sentences = l.modern.map(clean);
  state.target = []; state.ranges = [];
  const cols = [];
  let tx = 0;
  sentences.forEach((text, si) => {
    const withSep = si < sentences.length - 1 ? text + ' ' : text;
    const cps = [...withSep];
    state.ranges.push([tx, tx + cps.length]);
    state.target.push(...cps);
    for(const chunk of splitVertical(withSep)){
      const chars = [...chunk];
      cols.push(`<div class="col" data-sentence="${si}" data-from="${tx}" data-len="${[...chunk.trimEnd()].length}">`
              + `<div class="text">${chars.map(spanHtml).join('')}</div></div>`);
      tx += chars.length;
    }
  });

  // 책 모양: 열을 반엽(PER_HALF줄)씩 묶고, 반엽 둘 + 판심 = 한 장. 남는 자리는 빈 줄로 채운다.
  const BLANK = '<div class="col blank"></div>';
  const halves = [];
  for(let i = 0; i < cols.length; i += PER_HALF) halves.push(cols.slice(i, i + PER_HALF));
  const lastHalf = halves[halves.length - 1];
  while(lastHalf.length < PER_HALF) lastHalf.push(BLANK);
  if(halves.length % 2) halves.push(Array(PER_HALF).fill(BLANK));

  const bookName = esc([...l.book].slice(0, 8).join(''));
  let html = '';
  for(let h = 0; h < halves.length; h += 2){
    const no = h / 2 + 1;
    html += `<div class="leaf">`
          + `<div class="half">${halves[h].join('')}</div>`
          + `<div class="panshim" title="${no}장"><span class="eomi top"></span><span class="ps-title">${bookName}</span>`
          + `<span class="ps-no">${hanjaNum(no)}</span><span class="eomi bottom"></span></div>`
          + `<div class="half">${halves[h + 1].join('')}</div></div>`;
  }
  columns.innerHTML = html;
  state.cols  = [...columns.querySelectorAll('.col:not(.blank)')];
  state.spans = [...columns.querySelectorAll('.col .text span')];
}

// 곁글(언해본 또는 한문)을 번역 줄 옆에 붙인다.
// 원문의 각 어절을 '문장 안에서의 위치 비율'이 같은 번역 열에 붙이므로,
// 어순이 비슷한 언해본은 뜻이 맞는 구절 옆에 놓인다.
function buildGlosses(){
  const l = curLesson();
  const has = m => m === 'none' || (Array.isArray(l[m]) && l[m].length);
  state.gloss = has(settings.gloss) ? settings.gloss : (has('eonhae') ? 'eonhae' : has('original') ? 'original' : 'none');

  document.querySelectorAll('#glossMode button').forEach(btn => {
    const m = btn.dataset.gloss;
    btn.classList.toggle('active', m === state.gloss);
    btn.disabled = !has(m);
    if(m === 'eonhae') btn.textContent = (l.labels && l.labels.eonhae) || '언해본';
  });

  columns.querySelectorAll('.gloss').forEach(g => g.remove());
  const src = state.gloss === 'none' ? null : l[state.gloss];
  if(!src) return;

  src.forEach((sentence, si) => {
    const sc = state.cols.filter(c => +c.dataset.sentence === si);
    if(!sc.length) return;
    const lens = sc.map(c => +c.dataset.len);
    const total = lens.reduce((a, b) => a + b, 0) || 1;
    let cum = 0;
    const bounds = lens.map(n => (cum += n) / total);

    const words = clean(sentence).split(' ').map(w => Hangul.graphemes(w));
    const srcTotal = words.reduce((a, w) => a + w.length, 0) || 1;
    const perCol = sc.map(() => []);
    let before = 0;
    for(const w of words){
      const mid = (before + w.length / 2) / srcTotal;
      before += w.length;
      let ci = bounds.findIndex(b => mid <= b);
      perCol[ci < 0 ? sc.length - 1 : ci].push(w);
    }
    sc.forEach((c, ci) => {
      if(!perCol[ci].length) return;
      const g = document.createElement('div');
      g.className = 'gloss ' + state.gloss;
      g.style.setProperty('--n', lens[ci]);
      g.innerHTML = perCol[ci].map(w => w.map(ch => `<span>${esc(ch)}</span>`).join('')).join('<span class="gap"></span>');
      c.appendChild(g);
    });
  });
}

// 번역을 친 분량만큼 그 열 옆 곁글을 위에서부터 색칠한다.
function fillGloss(pos){
  for(const c of state.cols){
    const g = c.querySelector('.gloss'); if(!g) continue;
    const from = +c.dataset.from, len = +c.dataset.len;
    const done = Math.max(0, Math.min(len, pos - from));
    const sp = g.querySelectorAll('span:not(.gap)');
    const lit = done >= len ? sp.length : Math.floor(sp.length * done / len);
    sp.forEach((x, i) => x.classList.toggle('lit', i < lit));
  }
}

// 지금 치는 문장을 아래 안내줄에 가로로 보여준다 (세로 화면의 글자 상태를 그대로 옮김).
function renderGuide(pos){
  const g = $('hGuide');
  if(!settings.guide) return;
  const track = $('hgTrack');
  let si = state.ranges.findIndex(([, b]) => pos < b);
  if(si < 0) si = state.ranges.length - 1;
  const [from, to] = state.ranges[si] || [0, 0];
  let html = '';
  for(let i = from; i < to; i++){
    const sp = state.spans[i]; if(!sp) continue;
    const want = sp.dataset.want ? ` data-want="${esc(sp.dataset.want)}"` : '';
    const pn = sp.dataset.pn ? ' data-pn="1"' : '';
    html += `<span class="${sp.className}"${want}${pn}>${esc(sp.textContent)}</span>`;
  }
  track.innerHTML = html;
  // 커서가 안내줄 가운데쯤 오도록 옮긴다 (짧은 문장은 가운데 정렬)
  const W = g.clientWidth, T = track.scrollWidth;
  let x;
  if(T <= W * .9) x = (W - T) / 2;
  else{
    const cur = track.querySelector('.caret-after, .caret-before');
    const cx = cur ? cur.offsetLeft + (cur.classList.contains('caret-after') ? cur.offsetWidth : 0) : 0;
    x = Math.min(W * .06, Math.max(W * .94 - T, W * .45 - cx));
  }
  track.style.transform = `translateX(${x}px)`;
}

// 커서가 있는 열을 화면 가운데로 가로 스크롤한다.
function centerCurrentColumn(smooth = true){
  const cur = columns.querySelector('.caret-after, .caret-before');
  const col = cur && cur.closest('.col');
  if(!col) return;
  const a = col.getBoundingClientRect(), v = columns.getBoundingClientRect();
  const delta = (a.left + a.width / 2) - (v.left + v.width / 2);
  if(Math.abs(delta) > 2) columns.scrollBy({ left: delta, behavior: smooth ? 'smooth' : 'auto' });
}

const HINT_START = '✏️ 바로 타자를 치면 시작됩니다<small>흐린 글자 위에 그대로 덮어 쓰듯 입력하세요</small>';
const HINT_PAUSE = '⏸ 잠시 멈춤 · 시간도 멈췄어요<small>클릭하거나 아무 키나 누르면 이어서 입력합니다</small>';
function showHint(html){ hint.innerHTML = html; hint.hidden = false; }

/** 문헌 하나를 처음 상태로 그린다 */
function render(){
  const l = curLesson();
  settings.lastId = l.id; store.save();
  $('bookEra').textContent = l.era || '';
  $('bookTitle').textContent = l.title ? `${l.book} · ${l.title}` : l.book;
  $('description').textContent = l.desc || '';
  $('aboutText').textContent = l.about || '';
  $('lessonPill').textContent = `${state.idx + 1} / ${allLessons().length}`;
  buildColumns(l);
  buildGlosses();

  Object.assign(state, {
    composing:false, completed:false, clockMs:0, runSince:0,
    judged:0, mistakes:0, misses:{}, prevWrong:0, samples:[]
  });
  typing.value = ''; typing.readOnly = false;
  typing.maxLength = state.target.join('').length;
  closeResult();
  showHint(HINT_START);
  update();
  renderCards();
  requestAnimationFrame(() => { columns.scrollLeft = columns.scrollWidth; centerCurrentColumn(false); });
}

function loadLesson(i, { scroll = true } = {}){
  const n = allLessons().length;
  state.idx = ((i % n) + n) % n;
  render();
  if(scroll) $('practice').scrollIntoView({ behavior:'smooth', block:'start' });
  typing.focus({ preventScroll:true });
}

/* ---------------- 5. 입력 판정 ---------------- */
const showChar  = c => c === ' ' ? '␣' : c;
const charLabel = c => PUNCT_NAME[c] || `'${c}'`;
const eulReul   = c => PUNCT_NAME[c] ? '를' : /[가-힣]/.test(c) ? (Hangul.hasBatchim(c) ? '을' : '를') : '을(를)';
const isLatin   = c => /[A-Za-z]/.test(c || '');

function setStatus(text, kind = ''){
  const st = $('typeStatus');
  st.textContent = text;
  st.className = 'type-status' + (kind ? ' ' + kind : '');
}
let flashTimer = null;
function flashStatus(msg){
  setStatus(msg, 'info');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(update, 1800);
}

function update(){
  const T = state.target;
  const typed = [...typing.value];
  const spans = state.spans;

  for(const s of spans){
    s.className = s.dataset.c === ' ' ? 'sp' : '';
    s.textContent = s.dataset.c;
    delete s.dataset.want;
  }

  // 마지막 글자가 아직 조합 중이면 확정된 글자로 보지 않는다 (확정될 때 판정).
  const committed = state.composing ? Math.max(0, typed.length - 1) : typed.length;
  const pos = Math.min(typed.length, T.length);

  // 고친 오타까지 세는 누적 오타: 새로 확정된 글자만 한 번씩 판정한다.
  if(committed < state.judged) state.judged = committed;
  for(let k = state.judged; k < committed; k++){
    if(typed[k] !== T[k]){
      state.mistakes++;
      if(T[k] !== undefined) state.misses[T[k]] = (state.misses[T[k]] || 0) + 1;
    }
  }
  state.judged = committed;

  let correct = 0, wrong = 0, lastWrong = null, latin = false;
  for(let k = 0; k < committed; k++){
    const span = spans[k];
    if(typed[k] === T[k]){
      correct++;
      span && span.classList.add('correct');
    }else{
      wrong++;
      lastWrong = { typed: typed[k], want: T[k] };
      if(isLatin(typed[k]) && !isLatin(T[k])) latin = true;
      if(span){
        span.classList.add('wrong');
        span.textContent = showChar(typed[k]);          // 실제로 친 글자 (빨강 + 밑줄)
        span.dataset.want = showChar(T[k] ?? '');        // 원래 글자 (옆에 작게)
      }
    }
  }

  // 조합 중인 글자는 원래 글자 자리에 그대로 겹쳐 보여준다 (ㅇ → 우 → 울 → 우|리)
  if(state.composing && typed.length && spans[typed.length - 1]){
    const span = spans[typed.length - 1];
    span.classList.add('composing');
    span.textContent = typed[typed.length - 1];
  }

  // 커서: 마지막으로 친 글자 바로 뒤, 아무것도 안 쳤으면 첫 글자 앞
  if(typed.length && spans[typed.length - 1]) spans[typed.length - 1].classList.add('caret-after');
  else if(!typed.length && spans[0]) spans[0].classList.add('caret-before');

  state.live = { pos, correct, committed, wrong };
  fillGloss(pos);
  renderGuide(pos);
  requestAnimationFrame(() => centerCurrentColumn());
  updateStats();

  // 상태 문구
  const accPct = committed ? Math.round(correct / committed * 100) : 100;
  if(latin)                  setStatus('영문이 입력됐어요 · 한/영 키로 한글 입력을 확인하고, 백스페이스로 지운 뒤 다시 쳐 주세요', 'warn');
  else if(lastWrong)         setStatus(`${charLabel(lastWrong.want)} 자리에 ${charLabel(lastWrong.typed)}${eulReul(lastWrong.typed)} 입력했어요 · 백스페이스로 고치세요 (오타 ${wrong}개)`, 'warn');
  else if(pos === T.length)  setStatus('입력 완료 · 정확도 ' + accPct + '%', 'ok');
  else if(typed.length)      setStatus(`${pos} / ${T.length} 입력 중`);
  else                       setStatus('흐린 글자 위에 그대로 덮어 쓰세요 · 띄어쓰기 자리는 짧은 가로 획(–)으로 표시됩니다');

  if(wrong > state.prevWrong) playWrong();
  state.prevWrong = wrong;

  // 끝까지 쳤고 마지막 글자도 맞으면 완료
  const lastOk = !state.composing || typed[typed.length - 1] === T[T.length - 1];
  if(T.length && pos === T.length && lastOk && !state.completed) finish();
}

function updateStats(){
  const { pos, correct, committed } = state.live;
  const T = state.target.length || 1;
  const pct = Math.min(100, Math.round(pos / T * 100));
  $('bar').style.width = pct + '%';
  $('percent').textContent = pct + '%';
  $('accuracy').textContent = (committed ? Math.round(correct / committed * 100) : 100) + '%';
  $('errors').innerHTML = `${state.live.wrong}<small>/ ${state.mistakes}</small>`;
  $('cpm').textContent = currentCpm();
  $('elapsed').textContent = fmtTime(Math.floor(elapsedMs() / 1000));
  const best = bestOf(curLesson().id);
  $('bestCpm').innerHTML = best ? `${best}<small>타</small>` : '–';
}

// 0.5초마다 시계·타수를 새로 고치고, 그래프용 표본을 1초 간격으로 모은다.
setInterval(() => {
  if(!state.runSince) return;
  updateStats();
  const t = Math.floor(elapsedMs() / 1000);
  const last = state.samples[state.samples.length - 1];
  if(t >= 2 && (!last || last.t < t)) state.samples.push({ t, cpm: currentCpm() });
}, 500);

/* ---------------- 6. 결과창과 기록 ---------------- */
function getGrade(cpm, acc){
  if(acc >= 96 && cpm >= 340) return { label:'1급 · 명필',  top:true };
  if(acc >= 92 && cpm >= 240) return { label:'2급 · 달필',  top:true };
  if(acc >= 85 && cpm >= 140) return { label:'3급 · 정자체', top:false };
  return { label:'연습생 · 초심자', top:false };
}

function finish(){
  state.completed = true;
  typing.readOnly = true;
  const cpm = currentCpm();
  pauseClock();
  const sec = Math.max(1, Math.round(state.clockMs / 1000));
  const { correct, committed } = state.live;
  const acc = committed ? Math.round(correct / committed * 100) : 100;
  state.samples.push({ t: state.clockMs / 1000, cpm });

  const l = curLesson();
  const prevBest = bestOf(l.id);
  const rec = { id:l.id, title: l.title ? `${l.book} · ${l.title}` : l.book, cpm, acc, sec, mistakes: state.mistakes, at: Date.now() };
  store.data.records.push(rec);
  if(store.data.records.length > 300) store.data.records.splice(0, store.data.records.length - 300);
  store.save();
  renderRecords(); renderCards(); updateStats();
  setTimeout(() => showResult(rec, prevBest), 450);
}

function showResult(rec, prevBest){
  const g = getGrade(rec.cpm, rec.acc);
  const badge = $('resultBadge');
  badge.textContent = g.label;
  badge.classList.toggle('top', g.top);
  $('rCpm').textContent = rec.cpm;
  $('rAcc').textContent = rec.acc + '%';
  $('rTime').textContent = fmtTime(rec.sec);
  $('newBest').textContent =
    !prevBest          ? '이 문헌의 첫 기록이 남았습니다' :
    rec.cpm > prevBest ? `🏅 최고 기록 갱신! ${prevBest} → ${rec.cpm}타` :
                         `이 문헌 최고 기록 ${prevBest}타`;
  drawChart(state.samples);

  const top = Object.entries(state.misses).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $('rMisses').innerHTML = top.length
    ? '자주 틀린 글자 ' + top.map(([c, n]) => `<span class="miss">${esc(showChar(c))}<small>×${n}</small></span>`).join('')
    : (rec.mistakes ? '' : '한 번도 틀리지 않았어요 ✨');
  $('rMisses').insertAdjacentHTML('afterbegin', rec.mistakes ? `<div>고친 것까지 오타 ${rec.mistakes}회</div>` : '');

  $('resultOverlay').hidden = false;
  playComplete();
}

function drawChart(samples){
  const box = $('rChart');
  if(samples.length < 3){ box.hidden = true; return; }
  box.hidden = false;
  const W = 300, H = 70, P = 4;
  const maxT = samples[samples.length - 1].t || 1;
  const maxC = Math.max(...samples.map(s => s.cpm), 1);
  const pts = samples.map(s => [ (s.t / maxT) * W, H - P - (s.cpm / maxC) * (H - P * 2) ]);
  const line = pts.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  $('rChartSvg').innerHTML =
      `<polygon points="0,${H} ${line} ${W},${H}" style="fill:var(--accent);opacity:.12"/>`
    + `<polyline points="${line}" style="fill:none;stroke:var(--accent);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round"/>`;
  $('rChartMax').textContent = `최고 ${maxC}타`;
}

function closeResult(){ $('resultOverlay').hidden = true; }
function retryLesson(){ loadLesson(state.idx, { scroll:false }); hint.hidden = true; }
function nextLesson(){ loadLesson(state.idx + 1, { scroll:false }); }

function renderRecords(){
  const recs = store.data.records;
  const totalSec = recs.reduce((a, r) => a + r.sec, 0);
  $('sumCount').textContent = recs.length + '회';
  $('sumTime').textContent = totalSec < 60 ? totalSec + '초' : Math.round(totalSec / 60) + '분';
  $('sumAvg').textContent = recs.length ? Math.round(recs.reduce((a, r) => a + r.cpm, 0) / recs.length) + '타' : '–';
  $('sumBest').textContent = recs.length ? Math.max(...recs.map(r => r.cpm)) + '타' : '–';

  if(!recs.length){
    $('recordTable').innerHTML = '<div class="empty">아직 기록이 없어요. 한 편을 끝까지 옮겨 적으면 여기에 쌓입니다.</div>';
    return;
  }
  const d = new Intl.DateTimeFormat('ko', { month:'numeric', day:'numeric', hour:'2-digit', minute:'2-digit' });
  const rows = recs.slice(-15).reverse().map(r => `<tr>
      <td>${esc(d.format(r.at))}</td><td>${esc(r.title)}</td>
      <td class="num">${r.cpm}타</td><td class="num">${r.acc}%</td>
      <td class="num">${fmtTime(r.sec)}</td><td>${getGrade(r.cpm, r.acc).label}</td></tr>`).join('');
  $('recordTable').innerHTML = `<table><thead><tr><th>날짜</th><th>문헌</th><th>타수</th><th>정확도</th><th>시간</th><th>급수</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/* ---------------- 7. 문헌 목록 · 내 글 넣기 ---------------- */
function renderCards(){
  const html = allLessons().map((l, i) => {
    const n = l.modern.join(' ').length;
    const level = n < 90 ? '짧은 글' : n < 150 ? '보통' : '긴 글';
    const best = bestOf(l.id);
    const tags = [`${n}자`, level];
    if(l.eonhae)   tags.push((l.labels && l.labels.eonhae) || '언해본');
    if(l.original) tags.push('한문');
    return `<article class="card${i === state.idx ? ' current' : ''}" role="button" tabindex="0" data-i="${i}">
        <div class="num">${String(i + 1).padStart(2,'0')} · ${esc(l.era || '')}</div>
        <h3>${esc(l.book)}</h3>${l.title ? `<div class="sub">${esc(l.title)}</div>` : ''}
        <p>${esc(l.desc || '')}</p>
        <div class="meta">${tags.map(t => `<span class="tag">${esc(t)}</span>`).join('')}${best ? `<span class="tag gold">최고 ${best}타</span>` : ''}</div>
        ${l.custom ? '' : `<a class="card-link" href="lessons/${esc(l.id)}.html">원문과 풀이 보기 →</a>`}
        ${l.custom ? `<button type="button" class="card-del" data-del="${esc(l.id)}" aria-label="이 글 지우기" title="지우기">✕</button>` : ''}
      </article>`;
  }).join('');
  $('cards').innerHTML = html + `<button type="button" class="card add" id="addCustom"><b>＋</b>내 글로 연습하기<p>좋아하는 시나 문장을 넣어 세로쓰기로 연습해 보세요</p></button>`;
}


// 붙여 넣은 글을 문장 단위로 나눈다: 줄바꿈 → 문장부호 뒤 띄어쓰기
function splitSentences(raw){
  return raw.split(/\n+/).map(clean).filter(Boolean)
    .flatMap(line => line.split(/(?<=[.?!。])\s+/).map(clean).filter(Boolean));
}
function openCustom(){
  $('customHelp').textContent = '최대 800자 · 이 브라우저에 저장되어 문헌 목록에 추가됩니다.';
  $('customHelp').classList.remove('err');
  $('customOverlay').hidden = false;
  $('customName').focus();
}
function closeCustom(){ $('customOverlay').hidden = true; }
function saveCustom(e){
  e.preventDefault();
  const sentences = splitSentences($('customText').value);
  const help = $('customHelp');
  if(!sentences.length){ help.textContent = '연습할 문장을 적어 주세요.'; help.classList.add('err'); return; }
  const name = clean($('customName').value) || '내 글';
  store.data.custom.push({
    id: 'custom-' + Date.now(), era: '내 글', book: name, title: '',
    desc: sentences[0].length > 50 ? sentences[0].slice(0, 50) + '…' : sentences[0],
    about: '직접 넣은 글입니다. 문헌 목록의 ✕ 단추로 지울 수 있어요.',
    modern: sentences, custom: true
  });
  store.save();
  $('customName').value = ''; $('customText').value = '';
  closeCustom();
  loadLesson(allLessons().length - 1);
}
function deleteCustom(id){
  const list = store.data.custom;
  const k = list.findIndex(l => l.id === id);
  if(k < 0 || !confirm(`'${list[k].book}' 글을 목록에서 지울까요? (기록은 남습니다)`)) return;
  const curId = curLesson().id;
  list.splice(k, 1);
  store.save();
  const idx = allLessons().findIndex(l => l.id === curId);
  if(idx < 0){ state.idx = 0; render(); }
  else { state.idx = idx; $('lessonPill').textContent = `${idx + 1} / ${allLessons().length}`; renderCards(); }
}

/* ---------------- 8. 설정 ---------------- */
function applyTheme(){
  const dark = settings.theme ? settings.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('themeBtn').textContent = dark ? '☀️' : '🌙';
  $('themeBtn').title = dark ? '한지(밝은) 테마로' : '먹(어두운) 테마로';
}
function applySize(){
  document.documentElement.style.setProperty('--fs', SIZES[settings.size] || SIZES.m);
  document.querySelectorAll('#sizeSeg button').forEach(b => b.classList.toggle('active', b.dataset.size === settings.size));
}
function applyToggles(){
  $('hGuide').classList.toggle('off', !settings.guide);
  $('guideToggle').textContent = settings.guide ? '가로 안내줄 켜짐' : '가로 안내줄 꺼짐';
  $('guideToggle').classList.toggle('active', settings.guide);
  $('soundToggle').textContent = settings.sound ? '🔊 효과음 켜짐' : '🔇 효과음 꺼짐';
  $('soundToggle').classList.toggle('active', settings.sound);
}

/* ---------------- 9. 이벤트 연결 ---------------- */
function focusTyping(){
  if(state.completed) return;
  hint.hidden = true;
  typing.focus({ preventScroll:true });
}
function practiceInView(){
  const r = $('practice').getBoundingClientRect();
  return r.bottom > 80 && r.top < innerHeight - 80;
}

stage.addEventListener('click', focusTyping);
$('startBtn').addEventListener('click', focusTyping);
$('restartBtn').addEventListener('click', () => { retryLesson(); flashStatus('처음부터 다시 씁니다'); });
$('prevBtn').addEventListener('click', () => loadLesson(state.idx - 1, { scroll:false }));
$('nextBtn').addEventListener('click', () => loadLesson(state.idx + 1, { scroll:false }));
$('retryBtn').addEventListener('click', retryLesson);
$('nextLessonBtn').addEventListener('click', nextLesson);

$('glossMode').addEventListener('click', e => {
  const btn = e.target.closest('button'); if(!btn || btn.disabled) return;
  settings.gloss = btn.dataset.gloss; store.save();
  buildGlosses(); update();
});
$('sizeSeg').addEventListener('click', e => {
  const btn = e.target.closest('button'); if(!btn) return;
  settings.size = btn.dataset.size; store.save();
  applySize(); requestAnimationFrame(() => { update(); centerCurrentColumn(false); });
});
$('guideToggle').addEventListener('click', () => { settings.guide = !settings.guide; store.save(); applyToggles(); update(); });
$('soundToggle').addEventListener('click', () => { settings.sound = !settings.sound; store.save(); applyToggles(); });
$('themeBtn').addEventListener('click', () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  settings.theme = dark ? 'light' : 'dark'; store.save(); applyTheme();
});
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if(!settings.theme) applyTheme(); });

// 연습 영역 안의 단추를 눌러도 입력이 끊기지 않게 입력창으로 되돌린다.
$('practice').addEventListener('click', e => {
  if(!state.completed && e.target.closest('button') && (typing.value.length || hint.hidden)){
    typing.focus({ preventScroll:true });
  }
});

$('cards').addEventListener('click', e => {
  const del = e.target.closest('[data-del]');
  if(del){ e.stopPropagation(); deleteCustom(del.dataset.del); return; }
  if(e.target.closest('a')) return;                 // 원문 페이지 링크는 그대로 이동
  if(e.target.closest('#addCustom')){ openCustom(); return; }
  const card = e.target.closest('.card[data-i]');
  if(card) loadLesson(+card.dataset.i);
});
$('cards').addEventListener('keydown', e => {
  const card = e.target.closest('.card[data-i]');
  if(card && e.target === card && (e.key === 'Enter' || e.key === ' ')){ e.preventDefault(); loadLesson(+card.dataset.i); }
});
$('customForm').addEventListener('submit', saveCustom);
$('customCancel').addEventListener('click', closeCustom);
$('customOverlay').addEventListener('click', e => { if(e.target.id === 'customOverlay') closeCustom(); });
$('clearRecords').addEventListener('click', () => {
  if(!store.data.records.length || !confirm('지금까지의 연습 기록을 모두 지울까요?')) return;
  store.data.records = []; store.save(); renderRecords(); renderCards(); updateStats();
});

// 위쪽 메뉴: 보고 있는 구역을 표시
const navLinks = [...document.querySelectorAll('.topnav a')];
const io = new IntersectionObserver(entries => {
  entries.forEach(en => {
    if(en.isIntersecting) navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + en.target.id));
  });
}, { rootMargin:'-45% 0px -50% 0px' });
['practice','library','records','about'].forEach(id => io.observe($(id)));

// 키보드
document.addEventListener('keydown', e => {
  // 결과창: Enter 다음 문헌, Esc 다시 쓰기
  if(!$('resultOverlay').hidden){
    if(e.key === 'Enter'){ e.preventDefault(); nextLesson(); }
    else if(e.key === 'Escape'){ e.preventDefault(); retryLesson(); }
    return;
  }
  if(!$('customOverlay').hidden){ if(e.key === 'Escape') closeCustom(); return; }

  if(e.ctrlKey && !e.isComposing && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')){
    e.preventDefault();
    loadLesson(state.idx + (e.key === 'ArrowRight' ? 1 : -1), { scroll:false });
    return;
  }

  if(document.activeElement === typing){
    if(e.key === 'Escape' && !e.isComposing){ e.preventDefault(); retryLesson(); flashStatus('처음부터 다시 씁니다'); return; }
    // 보이지 않는 입력창이라 커서가 중간으로 옮겨지면 화면과 어긋나므로 이동 키는 막는다.
    if(NAV_KEYS.includes(e.key)){ e.preventDefault(); return; }
    if(!state.completed && (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Process')) playClick();
    return;
  }

  // 입력창 밖에서 눌린 첫 키는 한글 입력기를 거치지 않아 'D'처럼 영문으로 들어간다.
  // 그래서 그 키는 버리고 입력창만 켠 뒤, 다시 치도록 안내한다.
  if(state.completed || e.ctrlKey || e.metaKey || e.altKey) return;
  const tag = (document.activeElement && document.activeElement.tagName) || '';
  if(tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if(document.activeElement && document.activeElement.closest && document.activeElement.closest('.card') && (e.key === 'Enter' || e.key === ' ')) return;
  const typable = e.key.length === 1 || e.key === 'Process' || e.key === 'Backspace';
  if(typable && practiceInView()){
    e.preventDefault();
    focusTyping();
    flashStatus('입력을 다시 켰어요 · 방금 누른 글자부터 다시 쳐 주세요');
  }
});

// 한글 입력기 조합 상태 (조합 중인 글자는 오타로 치지 않기 위해)
typing.addEventListener('compositionstart', () => { state.composing = true; });
typing.addEventListener('compositionend',   () => { state.composing = false; update(); });
typing.addEventListener('input', () => {
  if(state.completed) return;
  resumeClock();
  hint.hidden = true;
  stage.classList.add('is-typing');
  clearTimeout(typing._pause);
  typing._pause = setTimeout(() => stage.classList.remove('is-typing'), 600);
  update();
});
typing.addEventListener('focus', () => {
  stage.classList.add('focused');
  if(typing.value.length && !state.completed) hint.hidden = true;
  const n = typing.value.length; typing.setSelectionRange(n, n);
});
typing.addEventListener('blur', () => {
  stage.classList.remove('focused');
  pauseClock();                                   // 창을 벗어나면 시간도 멈춘다
  if(!state.completed && typing.value.length){ showHint(HINT_PAUSE); updateStats(); }
});
window.addEventListener('resize', () => { update(); });

/* ---------------- 시작 ---------------- */
applyTheme(); applySize(); applyToggles();
// 주소에 ?lesson=문헌id 가 있으면 그 문헌으로 (원문 페이지의 '타자 연습하기' 단추), 없으면 마지막으로 보던 문헌
const wanted = new URLSearchParams(location.search).get('lesson') || settings.lastId;
state.idx = Math.max(0, allLessons().findIndex(l => l.id === wanted));
render();
renderRecords();
// 처음부터 입력창이 켜져 있어야 첫 키도 한글 입력기를 거친다.
typing.focus({ preventScroll:true });
