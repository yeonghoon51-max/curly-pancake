/* =========================================================
   말풍선 처리 — 원래 글자 지우기 + 번역 글자 넣기
   Claude 가 알려 준 상자(box)는 대략적이라서, 여기서 실제 그림을 보고
   말풍선의 하얀 영역을 찾아 그 모양대로 지우고 글자를 넣는다.

   흐름
   1. analyzeRegion(): 상자 가운데의 밝은 픽셀에서 시작해 flood fill
      → 말풍선 안쪽(흰 바탕) + 그 안에 갇힌 구멍(원래 글자)을 마스크로 만든다.
      → 바깥으로 새면(테두리 없는 말풍선, 그림 위 글자) 사각형 상자로 대신한다.
   2. paintRegion(): 마스크를 바탕색으로 칠해 원래 글자를 지운다.
   3. drawText(): 마스크의 줄마다 실제 폭을 재서, 타원 말풍선 안에 맞게 줄바꿈한다.
   ========================================================= */

const LIGHT = 200;          // 이 밝기(0~255) 이상이면 "말풍선 바탕"으로 본다
const SEARCH_PAD = 0.18;    // 상자를 사방으로 몇 % 넓혀서 찾을지

const lum = (d, i) => (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * 한 영역을 분석해 지울 마스크와 글자 넣을 범위를 만든다.
 * @param {ImageData} full 페이지 전체 픽셀
 * @param {{x:number,y:number,w:number,h:number}} box 원본 이미지 좌표의 상자
 * @param {'auto'|'box'|'none'} mode 지우는 방식
 * @returns 영역 정보 (rect, mask, rows, fill, ink, ok)
 */
export function analyzeRegion(full, box, mode = 'auto') {
  const W = full.width, H = full.height, d = full.data;
  const px = Math.round(box.w * SEARCH_PAD), py = Math.round(box.h * SEARCH_PAD);
  const rx = clamp(Math.floor(box.x - px), 0, W - 1);
  const ry = clamp(Math.floor(box.y - py), 0, H - 1);
  const rw = clamp(Math.ceil(box.w + px * 2), 1, W - rx);
  const rh = clamp(Math.ceil(box.h + py * 2), 1, H - ry);

  if (mode === 'auto') {
    const res = floodBubble(d, W, { x: rx, y: ry, w: rw, h: rh }, box);
    if (res) return res;
  }
  return rectRegion(d, W, H, box, mode);
}

/* 말풍선 찾기: 성공하면 영역, 실패(새어 나감·너무 작음)하면 null */
function floodBubble(d, W, R, box) {
  const n = R.w * R.h;
  const light = new Uint8Array(n);
  for (let y = 0; y < R.h; y++) {
    let i = ((R.y + y) * W + R.x) * 4;
    for (let x = 0; x < R.w; x++, i += 4) light[y * R.w + x] = lum(d, i) >= LIGHT ? 1 : 0;
  }

  // 씨앗: 원래 상자 안쪽 60% 구역의 밝은 픽셀들 (상자 가운데에 가까운 것부터)
  const cx = box.x - R.x + box.w / 2, cy = box.y - R.y + box.h / 2;
  const seeds = [];
  const bx0 = Math.round(cx - box.w * 0.3), bx1 = Math.round(cx + box.w * 0.3);
  const by0 = Math.round(cy - box.h * 0.3), by1 = Math.round(cy + box.h * 0.3);
  const step = Math.max(2, Math.round(Math.min(box.w, box.h) / 14));
  for (let y = clamp(by0, 0, R.h - 1); y <= clamp(by1, 0, R.h - 1); y += step)
    for (let x = clamp(bx0, 0, R.w - 1); x <= clamp(bx1, 0, R.w - 1); x += step)
      if (light[y * R.w + x]) seeds.push(y * R.w + x);
  if (!seeds.length) return null;
  seeds.sort((p, q) => dist2(p) - dist2(q));
  function dist2(k) { const x = k % R.w, y = (k - x) / R.w; return (x - cx) ** 2 + (y - cy) ** 2; }

  // 씨앗마다 이어진 밝은 덩어리를 따로 칠한다 (4방향 flood fill, 재귀 대신 스택 — 자바의 Deque 와 같은 방식).
  // 상자가 조금 어긋나 씨앗 몇 개가 말풍선 바깥(흰 칸 바탕)에 떨어져도, 말풍선 덩어리만 골라 쓸 수 있다.
  const label = new Int32Array(n);
  const comps = [null];
  const perimeter = 2 * (R.w + R.h);
  for (const seed of seeds) {
    if (label[seed]) { comps[label[seed]].seeds++; continue; }
    const id = comps.length;
    const comp = { id, area: 0, touch: 0, seeds: 1, rank: comps.length };
    comps.push(comp);
    const stack = [seed];
    label[seed] = id;
    while (stack.length) {
      const k = stack.pop(); comp.area++;
      const x = k % R.w, y = (k - x) / R.w;
      if (x === 0 || y === 0 || x === R.w - 1 || y === R.h - 1) comp.touch++;
      if (x > 0 && light[k - 1] && !label[k - 1]) { label[k - 1] = id; stack.push(k - 1); }
      if (x < R.w - 1 && light[k + 1] && !label[k + 1]) { label[k + 1] = id; stack.push(k + 1); }
      if (y > 0 && light[k - R.w] && !label[k - R.w]) { label[k - R.w] = id; stack.push(k - R.w); }
      if (y < R.h - 1 && light[k + R.w] && !label[k + R.w]) { label[k + R.w] = id; stack.push(k + R.w); }
    }
  }
  // 바깥으로 새지 않고(테두리에 거의 안 닿음) 충분히 큰 덩어리 중, 씨앗을 가장 많이 품은 것
  const good = comps.slice(1).filter(c => c.touch <= perimeter * 0.12 && c.area >= box.w * box.h * 0.12);
  if (!good.length) return null;
  good.sort((p, q) => q.seeds - p.seeds || p.rank - q.rank);
  const pick = good[0].id;
  const fill = new Uint8Array(n);
  for (let k = 0; k < n; k++) if (label[k] === pick) fill[k] = 1;

  // 채운 영역의 경계 상자
  let x0 = R.w, y0 = R.h, x1 = -1, y1 = -1;
  for (let k = 0; k < n; k++) if (fill[k]) {
    const x = k % R.w, y = (k - x) / R.w;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  const mw = x1 - x0 + 1, mh = y1 - y0 + 1;

  // 구멍 메우기: 경계 상자 테두리에서 "채우지 않은 픽셀"을 따라 들어가 닿는 곳은 바깥.
  // 닿지 못한 채우지 않은 픽셀 = 말풍선 안에 갇힌 원래 글자 → 지울 대상.
  const outside = new Uint8Array(mw * mh);
  const st = [];
  const at = (x, y) => fill[(y + y0) * R.w + (x + x0)];
  const push = (x, y) => { const k = y * mw + x; if (!outside[k] && !at(x, y)) { outside[k] = 1; st.push(k); } };
  for (let x = 0; x < mw; x++) { push(x, 0); push(x, mh - 1); }
  for (let y = 0; y < mh; y++) { push(0, y); push(mw - 1, y); }
  while (st.length) {
    const k = st.pop(), x = k % mw, y = (k - x) / mw;
    if (x > 0) push(x - 1, y); if (x < mw - 1) push(x + 1, y);
    if (y > 0) push(x, y - 1); if (y < mh - 1) push(x, y + 1);
  }
  const mask = new Uint8Array(mw * mh);
  let r = 0, g = 0, b = 0, cnt = 0;
  for (let y = 0; y < mh; y++) for (let x = 0; x < mw; x++) {
    const k = y * mw + x;
    if (!outside[k]) {
      mask[k] = 1;
      if (at(x, y)) { const i = ((R.y + y0 + y) * W + R.x + x0 + x) * 4; r += d[i]; g += d[i + 1]; b += d[i + 2]; cnt++; }
    }
  }
  // 글자 가장자리의 흐린 픽셀까지 지우도록 마스크를 1px 넓힌다 (말풍선 안쪽에서만)
  const grown = mask.slice();
  for (let y = 1; y < mh - 1; y++) for (let x = 1; x < mw - 1; x++) {
    const k = y * mw + x;
    if (!mask[k] && (mask[k - 1] && mask[k + 1] || mask[k - mw] && mask[k + mw])) grown[k] = 1;
  }

  const fillColor = cnt ? [r / cnt, g / cnt, b / cnt].map(Math.round) : [255, 255, 255];
  const rect = { x: R.x + x0, y: R.y + y0, w: mw, h: mh };
  return { ok: true, kind: 'bubble', rect, mask: grown, fill: fillColor, ink: inkFor(fillColor),
           rows: rowSpans(grown, mw, mh, rect, box) };
}

/* 사각형 영역 (테두리 없는 말풍선, 해설 상자, 효과음) */
function rectRegion(d, W, H, box, mode) {
  const rect = {
    x: clamp(Math.round(box.x), 0, W - 1), y: clamp(Math.round(box.y), 0, H - 1),
    w: 0, h: 0,
  };
  rect.w = clamp(Math.round(box.w), 1, W - rect.x);
  rect.h = clamp(Math.round(box.h), 1, H - rect.y);
  // 바탕색: 상자 테두리 픽셀들의 중앙값 (그림 위에 뜬 글자 상자에 어울리는 색)
  const rs = [], gs = [], bs = [];
  const sample = (x, y) => { const i = (y * W + x) * 4; rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]); };
  for (let x = rect.x; x < rect.x + rect.w; x += 2) { sample(x, rect.y); sample(x, rect.y + rect.h - 1); }
  for (let y = rect.y; y < rect.y + rect.h; y += 2) { sample(rect.x, y); sample(rect.x + rect.w - 1, y); }
  const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1] ?? 255; };
  const fill = [med(rs), med(gs), med(bs)];
  const rows = [];
  const inset = Math.round(Math.min(rect.w, rect.h) * 0.08);
  for (let y = 0; y < rect.h; y++) rows.push([inset, rect.w - inset]);
  return { ok: false, kind: mode === 'none' ? 'none' : 'box', rect, mask: null, fill,
           ink: mode === 'none' ? [20, 20, 20] : inkFor(fill), rows };
}

/* 줄마다 [왼쪽, 오른쪽] 글자 넣을 수 있는 폭 — 원래 상자 범위 안으로 제한 */
function rowSpans(mask, mw, mh, rect, box) {
  const rows = [];
  const lim0 = Math.max(0, Math.round(box.x - rect.x - box.w * 0.06));
  const lim1 = Math.min(mw, Math.round(box.x - rect.x + box.w * 1.06));
  for (let y = 0; y < mh; y++) {
    let l = -1, r = -1;
    for (let x = lim0; x < lim1; x++) if (mask[y * mw + x]) { if (l < 0) l = x; r = x; }
    rows.push(l < 0 ? null : [l, r + 1]);
  }
  return rows;
}

const inkFor = ([r, g, b]) => ((r * 299 + g * 587 + b * 114) / 1000 > 140 ? [17, 17, 17] : [250, 250, 250]);
const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;

/** 원래 글자를 지운다 */
export function paintRegion(ctx, reg, style) {
  if (reg.kind === 'none') return;
  ctx.save();
  ctx.fillStyle = rgb(reg.fill);
  if (reg.mask) {
    // 마스크를 작은 캔버스에 그려 한 번에 덮는다 (픽셀 단위로 fillRect 하면 느림)
    const { w, h } = reg.rect;
    const off = new OffscreenCanvas(w, h);
    const oc = off.getContext('2d');
    const img = oc.createImageData(w, h);
    for (let k = 0; k < reg.mask.length; k++) if (reg.mask[k]) {
      const i = k * 4; img.data[i] = reg.fill[0]; img.data[i + 1] = reg.fill[1]; img.data[i + 2] = reg.fill[2]; img.data[i + 3] = 255;
    }
    oc.putImageData(img, 0, 0);
    ctx.drawImage(off, reg.rect.x, reg.rect.y);
  } else {
    const { x, y, w, h } = reg.rect;
    const rad = Math.min(w, h) * (style === 'narration' ? 0.04 : 0.18);
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, rad);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * 번역 글자를 영역 모양에 맞춰 넣는다.
 * 글자 크기를 이분 탐색해서 들어가는 가장 큰 크기를 고른다.
 */
export function drawText(ctx, reg, text, opts = {}) {
  text = (text || '').trim();
  if (!text) return;
  const family = opts.font || '"Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif';
  const weight = opts.weight || 700;
  const scale = opts.scale || 1;
  const { rect, rows } = reg;
  const usable = rows.map(r => r && r[1] - r[0]);
  if (!usable.some(Boolean)) return;

  const lineGap = 1.22;
  const fit = rowsToUse => {
    let lo = 6, hi = Math.max(8, Math.min(rect.h * 0.45, rect.w * 0.5)), best = null;
    for (let it = 0; it < 14; it++) {
      const size = (lo + hi) / 2;
      const layout = layoutAt(ctx, text, size, lineGap, rowsToUse, rect.h, family, weight);
      if (layout) { best = layout; lo = size; } else hi = size;
    }
    return best;
  };
  // 말풍선 모양에 맞춰 보고, 안 되면 사각형 전체를 쓴다
  let useRows = rows;
  let best = fit(rows);
  if (!best) { useRows = rows.map(() => [0, rect.w]); best = fit(useRows); }
  if (!best) return;

  // 사용자가 정한 글자 크기 배율 (0.6 ~ 1.4)
  let final = best;
  if (scale !== 1) {
    const s = best.size * clamp(scale, 0.6, 1.4);
    final = layoutAt(ctx, text, s, lineGap, useRows, rect.h, family, weight)
         || layoutAt(ctx, text, s, lineGap, useRows.map(() => [0, rect.w]), rect.h, family, weight)
         || best;
  }

  ctx.save();
  ctx.font = `${weight} ${final.size}px ${family}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const ink = rgb(reg.ink);
  if (reg.kind === 'none' || opts.outline) {
    // 효과음처럼 그림 위에 바로 쓸 때는 흰 테두리를 둘러 읽히게 한다
    ctx.lineJoin = 'round';
    ctx.lineWidth = Math.max(2, final.size * 0.22);
    ctx.strokeStyle = 'rgba(255,255,255,.95)';
    final.lines.forEach(l => ctx.strokeText(l.text, rect.x + l.cx, rect.y + l.cy));
  }
  ctx.fillStyle = ink;
  final.lines.forEach(l => ctx.fillText(l.text, rect.x + l.cx, rect.y + l.cy));
  ctx.restore();
}

/* 주어진 글자 크기로 줄바꿈해 보고, 들어가면 줄 정보를, 안 들어가면 null */
function layoutAt(ctx, text, size, gap, rows, H, family, weight) {
  ctx.font = `${weight} ${size}px ${family}`;
  const lh = size * gap;
  const measure = s => ctx.measureText(s).width;
  const pad = size * 0.35;

  // 줄 수를 1부터 늘려 가며, 세로 가운데 정렬했을 때 각 줄의 폭에 맞는지 확인
  const maxLines = Math.max(1, Math.floor(H / lh));
  const words = splitWords(text);
  for (let n = 1; n <= maxLines; n++) {
    const top = (H - n * lh) / 2;
    const widths = [], centers = [];
    let okRows = true;
    for (let i = 0; i < n; i++) {
      const y0 = Math.max(0, Math.floor(top + i * lh)), y1 = Math.min(H - 1, Math.ceil(top + (i + 1) * lh));
      let l = -Infinity, r = Infinity;
      for (let y = y0; y <= y1; y++) {
        const span = rows[y];
        if (!span) { okRows = false; break; }
        l = Math.max(l, span[0]); r = Math.min(r, span[1]);
      }
      if (!okRows || r - l - pad * 2 < size) { okRows = false; break; }
      widths.push(r - l - pad * 2); centers.push((l + r) / 2);
    }
    if (!okRows) continue;
    const lines = wrap(words, widths, measure);
    if (lines) {
      return { size, lines: lines.map((t, i) => ({ text: t, cx: centers[i], cy: top + (i + 0.5) * lh })) };
    }
  }
  return null;
}

/* 띄어쓰기 단위로 나누되, 문장부호는 앞 낱말에 붙인다 */
function splitWords(text) {
  return text.replace(/\s+/g, ' ').split(' ').filter(Boolean);
}

/* 줄마다 정해진 폭(widths)에 낱말을 채운다. 낱말 하나가 너무 길면 글자 단위로 쪼갠다 */
function wrap(words, widths, measure) {
  const lines = [];
  let li = 0, cur = '';
  const queue = words.slice();
  while (queue.length) {
    if (li >= widths.length) return null;
    const w = queue[0];
    const trial = cur ? cur + ' ' + w : w;
    if (measure(trial) <= widths[li]) { cur = trial; queue.shift(); continue; }
    if (!cur) {
      // 낱말 하나도 안 들어감 → 글자 단위로 자르기
      let cut = 1;
      while (cut < w.length && measure(w.slice(0, cut + 1)) <= widths[li]) cut++;
      if (measure(w.slice(0, cut)) > widths[li]) return null;
      lines.push(w.slice(0, cut)); queue[0] = w.slice(cut); li++;
      continue;
    }
    lines.push(cur); cur = ''; li++;
  }
  if (cur) { if (li >= widths.length) return null; lines.push(cur); li++; }
  return li === widths.length ? lines : null;   // 줄 수가 정확히 맞을 때만 (가운데 정렬 유지)
}
