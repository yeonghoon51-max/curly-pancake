/* =========================================================
   Claude 에게 페이지(또는 일부)를 보내 글자 영역 찾기 + 원문 읽기 + 번역을 한 번에 받는다.
   API 키는 이 브라우저에만 저장되고, 요청은 브라우저에서 Anthropic 으로 바로 간다(서버 없음).
   ========================================================= */
import Anthropic from './vendor/anthropic-sdk.mjs';

export const MODELS = [
  { id: 'claude-opus-5-5',   label: 'Claude Opus 5.5 — 가장 정확 (기본)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 — 빠르고 저렴' },
  { id: 'claude-haiku-5-5',  label: 'Claude Haiku 5.5 — 가장 저렴' },
];

export const LANGS = {
  auto: '자동 감지', ja: '일본어', en: '영어', zh: '중국어', ko: '한국어',
};

const KINDS = ['speech', 'thought', 'narration', 'sfx', 'sign', 'other'];

// 구조화 출력(JSON 스키마): Claude 의 답이 반드시 이 모양으로 온다
const REGION = {
  type: 'object',
  additionalProperties: false,
  required: ['x0', 'y0', 'x1', 'y1', 'kind', 'speaker', 'original', 'translation'],
  properties: {
    x0: { type: 'integer', description: '왼쪽 위 x (픽셀)' },
    y0: { type: 'integer', description: '왼쪽 위 y (픽셀)' },
    x1: { type: 'integer', description: '오른쪽 아래 x (픽셀)' },
    y1: { type: 'integer', description: '오른쪽 아래 y (픽셀)' },
    kind: { type: 'string', enum: KINDS },
    speaker: { type: 'string', description: '말하는 인물 이름 또는 짧은 설명, 모르면 빈 문자열' },
    original: { type: 'string' },
    translation: { type: 'string' },
  },
};
const PAGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['regions'],
  properties: { regions: { type: 'array', items: REGION } },
};

const SYSTEM = `You are a professional manga/comic letterer and translator.
You receive one comic page (or a cropped part of one) and return every piece of text on it as structured data.

For each text region:
- Box: pixel coordinates in the image exactly as given (the size is stated in the request). For text inside a speech or thought balloon, the box encloses the whole balloon including its outline. For text with no balloon (narration on art, signs, sound effects), the box encloses the text itself with a small margin.
- kind: speech, thought, narration (caption boxes), sfx (sound effects / onomatopoeia drawn as art), sign (text that is part of the scene), other.
- original: the text exactly as written, joined into one line (vertical Japanese read top-to-bottom, columns right-to-left). Keep ruby/furigana out unless it is the only reading.
- translation: a natural, idiomatic translation into the target language that a native reader would find in a professionally published edition. Match each character's voice and register (casual speech, politeness levels, dialect, a child's or an elder's way of talking); keep jokes and wordplay working where possible rather than translating literally; keep it short enough to fit the balloon. For sfx, use the target language's own onomatopoeia.
- speaker: who is talking, if it can be inferred from the art; otherwise an empty string.

List regions in reading order for the page's format (right-to-left, top-to-bottom for Japanese manga; left-to-right for Western comics and webtoons).
Skip text that is not meant to be read as part of the story: page numbers, publisher marks, scanlation credits, watermarks.
If the image has no text, return an empty list.`;

let client = null, clientKey = '';
function getClient(apiKey) {
  if (!apiKey) throw new Error('설정에서 Anthropic API 키를 먼저 넣어 주세요.');
  if (!client || clientKey !== apiKey) {
    // dangerouslyAllowBrowser: 서버 없이 브라우저에서 바로 부르기 위한 옵션.
    // 키는 사용자의 브라우저에만 있으므로, 남과 같이 쓰는 컴퓨터에서는 쓰지 말 것.
    client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 2 });
    clientKey = apiKey;
  }
  return client;
}

/**
 * @param {object} p
 * @param {string} p.apiKey
 * @param {string} p.model
 * @param {'low'|'medium'|'high'} p.effort
 * @param {{data:string, mediaType:string, width:number, height:number}} p.image  base64 이미지
 * @param {string} p.source  원문 언어 코드
 * @param {string} p.target  번역할 언어 코드
 * @param {string} [p.glossary]  작품 정보·인물 이름·용어
 * @param {Array<{original:string, translation:string}>} [p.context]  앞 페이지 대사 (말투 일관성)
 * @param {boolean} [p.single]  사용자가 직접 고른 작은 영역인지
 * @param {AbortSignal} [p.signal]
 * @returns {Promise<{regions:Array, usage:object}>}
 */
export async function translateImage(p) {
  const c = getClient(p.apiKey);
  const target = LANGS[p.target] || p.target;
  const source = p.source === 'auto' ? 'detect it automatically' : (LANGS[p.source] || p.source);

  const lines = [
    `Image size: ${p.image.width} x ${p.image.height} pixels.`,
    `Source language: ${source}. Target language: ${target === '한국어' ? 'Korean (한국어)' : target}.`,
  ];
  if (p.single) lines.push('This image is a crop the user selected around one text region. Return it as a single region whose box covers the whole image, unless it clearly contains several separate balloons.');
  if (p.glossary?.trim()) lines.push(`Notes from the reader about this work (names, terms, tone) — follow them:\n${p.glossary.trim()}`);
  if (p.context?.length) {
    lines.push('Lines already translated on the previous page, for continuity of names and voice:\n' +
      p.context.slice(-30).map(r => `- ${r.original} → ${r.translation}`).join('\n'));
  }

  const params = {
    model: p.model,
    max_tokens: 16000,
    system: SYSTEM,
    output_config: { effort: p.effort || 'medium', format: { type: 'json_schema', schema: PAGE_SCHEMA } },
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: p.image.mediaType, data: p.image.data } },
        { type: 'text', text: lines.join('\n\n') },
      ],
    }],
  };

  let res;
  try {
    if (p.model === 'claude-haiku-5-5') {
      res = await c.messages.create(params, { signal: p.signal });
    } else {
      // 안전 분류기가 거절하면 서버에서 다른 모델로 자동 재시도 (Opus 5.5 / Sonnet 5.5)
      res = await c.beta.messages.create(
        { ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' },
        { signal: p.signal },
      );
    }
  } catch (e) {
    throw new Error(explainError(e));
  }

  if (res.stop_reason === 'refusal') {
    throw new Error('Claude 가 이 이미지의 번역을 거절했어요.' + (res.stop_details?.explanation ? ` (${res.stop_details.explanation})` : ''));
  }
  if (res.stop_reason === 'max_tokens') throw new Error('대사가 너무 많아 답이 잘렸어요. 페이지를 나눠서(영역 추가) 번역해 보세요.');

  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('번역 결과를 읽지 못했어요. 다시 시도해 주세요.'); }

  const W = p.image.width, H = p.image.height;
  const regions = (parsed.regions || []).map(r => {
    const x0 = Math.max(0, Math.min(r.x0, r.x1)), x1 = Math.min(W, Math.max(r.x0, r.x1));
    const y0 = Math.max(0, Math.min(r.y0, r.y1)), y1 = Math.min(H, Math.max(r.y0, r.y1));
    return { box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, kind: KINDS.includes(r.kind) ? r.kind : 'other',
             speaker: r.speaker || '', original: r.original || '', translation: r.translation || '' };
  }).filter(r => r.box.w >= 4 && r.box.h >= 4);

  return { regions, usage: res.usage, model: res.model };
}

/* SDK 의 오류 종류별로 알아듣기 쉬운 말로 바꾼다 (자바의 catch 를 여러 개 두는 것과 같음) */
function explainError(e) {
  if (e instanceof Anthropic.AuthenticationError) return 'API 키가 올바르지 않아요. 설정에서 키를 확인해 주세요.';
  if (e instanceof Anthropic.PermissionDeniedError) return '이 API 키로는 선택한 모델을 쓸 수 없어요. 설정에서 다른 모델을 골라 보세요.';
  if (e instanceof Anthropic.RateLimitError) return '요청이 너무 많아요. 잠시 뒤에 다시 시도해 주세요.';
  if (e instanceof Anthropic.BadRequestError) return '요청이 거부됐어요: ' + (e.error?.error?.message || e.message);
  if (e instanceof Anthropic.APIConnectionError) return '인터넷 연결을 확인해 주세요.';
  if (e instanceof Anthropic.APIUserAbortError || e?.name === 'AbortError') return '취소했어요.';
  if (e instanceof Anthropic.InternalServerError) return 'Anthropic 서버에 일시적인 문제가 있어요. 잠시 뒤에 다시 시도해 주세요.';
  if (e instanceof Anthropic.APIError) return `오류 (${e.status ?? '?'}): ${e.message}`;
  return e?.message || String(e);
}

/* 이미지를 Claude 에 보내기 좋은 크기(긴 변 최대 1568px)의 JPEG base64 로 만든다 */
export async function encodeForClaude(source, crop) {
  const sw = crop ? crop.w : source.width, sh = crop ? crop.h : source.height;
  const scale = Math.min(1, 1568 / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * scale)), h = Math.max(1, Math.round(sh * scale));
  const cv = new OffscreenCanvas(w, h);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);
  if (crop) ctx.drawImage(source, crop.x, crop.y, crop.w, crop.h, 0, 0, w, h);
  else ctx.drawImage(source, 0, 0, w, h);
  const blob = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return { data: btoa(bin), mediaType: 'image/jpeg', width: w, height: h, scale };
}
