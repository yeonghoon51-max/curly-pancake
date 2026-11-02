/* =========================================================
   한글 도우미
   - 자모 분해: 분당 타수를 "자모 입력 수" 기준으로 세기 위함
   - 글자(grapheme) 나누기: 옛한글은 자모 여러 개(ᄉ+ᆞ+ᆯ)가 모여 한 글자
   ========================================================= */
const Hangul = (() => {
  const CHO  = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  const JUNG = ['ㅏ','ㅐ','ㅑ','ㅒ','ㅓ','ㅔ','ㅕ','ㅖ','ㅗ','ㅘ','ㅙ','ㅚ','ㅛ','ㅜ','ㅝ','ㅞ','ㅟ','ㅠ','ㅡ','ㅢ','ㅣ'];
  const JONG = ['','ㄱ','ㄲ','ㄳ','ㄴ','ㄵ','ㄶ','ㄷ','ㄹ','ㄺ','ㄻ','ㄼ','ㄽ','ㄾ','ㄿ','ㅀ','ㅁ','ㅂ','ㅄ','ㅅ','ㅆ','ㅇ','ㅈ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];
  // 겹모음·겹받침은 실제로 키를 두 번 누른다 (ㅘ = ㅗ + ㅏ)
  const SPLIT = {
    'ㅘ':2,'ㅙ':2,'ㅚ':2,'ㅝ':2,'ㅞ':2,'ㅟ':2,'ㅢ':2,
    'ㄳ':2,'ㄵ':2,'ㄶ':2,'ㄺ':2,'ㄻ':2,'ㄼ':2,'ㄽ':2,'ㄾ':2,'ㄿ':2,'ㅀ':2,'ㅄ':2
  };

  /** 완성형 한 글자 → 자모 배열. 한글이 아니면 그 글자 그대로. */
  function decompose(ch){
    const code = ch.codePointAt(0) - 0xAC00;
    if(code < 0 || code > 11171) return [ch];
    const out = [CHO[Math.floor(code/588)], JUNG[Math.floor((code%588)/28)]];
    if(code % 28) out.push(JONG[code % 28]);
    return out;
  }

  /** 문자열을 치는 데 필요한 키 입력 수 */
  function keystrokes(str){
    let n = 0;
    for(const ch of str) for(const j of decompose(ch)) n += SPLIT[j] || 1;
    return n;
  }

  /** 받침이 있으면 true (을/를, 이/가 고르기) */
  function hasBatchim(ch){
    const code = (ch || '').charCodeAt(0) - 0xAC00;
    return code >= 0 && code <= 11171 && code % 28 !== 0;
  }

  const seg = (window.Intl && Intl.Segmenter) ? new Intl.Segmenter('ko', {granularity:'grapheme'}) : null;
  /** 옛한글 조합 글자가 깨지지 않게 글자 단위로 나눈다 */
  function graphemes(str){
    if(seg) return [...seg.segment(str)].map(x => x.segment);
    return str.match(/[ᄀ-ᅟꥠ-꥿]+[ᅠ-ᆧힰ-ퟆ]+[ᆨ-ᇿퟋ-ퟻ]*|[\s\S]/gu) || [];
  }

  return { decompose, keystrokes, hasBatchim, graphemes };
})();
