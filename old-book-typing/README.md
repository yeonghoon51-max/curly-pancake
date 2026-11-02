# 옛글자 · 고서 타자연습

훈민정음과 조선의 고서를 **세로쓰기 화면**으로 읽으며 타자하는 역사 타자연습 웹앱입니다.

## 실행

`index.html`을 더블클릭하거나 VS Code의 Live Server로 열면 됩니다.
GitHub Pages에 올릴 때는 **`old-book-typing` 폴더를 통째로** 올리세요 (css·js 폴더가 함께 있어야 합니다).

## 인터넷에 공개하고 검색되게 하기

### 1단계: 웹사이트로 올리기 (GitHub Pages, 무료)
1. 이 저장소를 GitHub에 push 하고 `main` 브랜치에 합칩니다.
2. 저장소 **Settings → Pages → Build and deployment → Source** 를 **GitHub Actions** 로 바꿉니다.
3. `.github/workflows/pages.yml` 이 `old-book-typing` 폴더를 자동으로 배포합니다.
   (Actions 탭에서 "Deploy 옛글자 site" 를 직접 실행해도 됩니다)
4. 주소: **https://yeonghoon51-max.github.io/curly-pancake/**

> 💡 주소를 `.../yetgeulja/` 처럼 바꾸고 싶으면 저장소 이름을 바꾼 뒤,
> `index.html`(canonical, og:url, og:image, JSON-LD), `robots.txt`, `sitemap.xml` 의 주소를 같이 바꾸세요.

### 2단계: 검색 포털에 등록하기
사이트를 올리기만 해도 언젠가는 검색되지만, 직접 등록하면 훨씬 빨라요 (보통 며칠 ~ 2주).

| 포털 | 등록하는 곳 | 할 일 |
|---|---|---|
| Google | [Google Search Console](https://search.google.com/search-console) | URL 접두어로 사이트 추가 → 소유 확인 → Sitemaps 에 `sitemap.xml` 제출 |
| Naver | [네이버 서치어드바이저](https://searchadvisor.naver.com) | 웹마스터 도구 → 사이트 등록 → 소유 확인 → 요청 → 사이트맵 제출 |
| Daum | [Daum 검색등록](https://register.search.daum.net/index.daum) | 사이트 주소 등록 |
| Bing | [Bing Webmaster Tools](https://www.bing.com/webmasters) | Google Search Console 에서 가져오기 가능 |

**소유 확인**은 "HTML 태그" 방식이 가장 쉬워요. 포털이 주는
`<meta name="google-site-verification" content="...">` (네이버는 `naver-site-verification`) 한 줄을
`index.html` 의 `<head>` 안에 붙여 넣고 다시 push 하면 됩니다.

### 이미 들어 있는 검색 최적화
- 검색 결과에 보일 제목·설명 (`<title>`, `meta description`, `keywords`)
- 카카오톡·페이스북 링크 미리보기 (`og:` 태그, `og-image.png`)
- 구조화 데이터 (JSON-LD `WebApplication`)
- `robots.txt`, `sitemap.xml`, 파비콘(`favicon.svg`)
- 자바스크립트 없이도 읽히는 소개 문구 (검색엔진 수집용)

## 파일 구조

```
old-book-typing/
├─ index.html        화면 뼈대
├─ css/style.css     디자인 (한지/먹 테마 색은 맨 위 변수에서 바꿈)
└─ js/
   ├─ lessons.js     수록 문헌 데이터  ← 새 문헌은 여기에 추가
   ├─ hangul.js      자모 분해 · 옛한글 글자 나누기
   └─ app.js         입력 판정 · 기록 · 설정 등 동작
```

## 기능

**타자 화면**
- 세로쓰기, 글자 위에 덮어 쓰는 메트로타이핑식 입력
- 조합 중 글자 제자리 표시, 확정될 때 오타 판정 (빨간 글자 + 원래 글자 곁표시)
- 어절 단위 줄바꿈, 띄어쓰기 자리 가로 획(–), 문장부호 세워서 표시
- 열 사이 계선(옛 책의 칸 줄)
- 아래쪽 가로 안내줄 (켜고 끄기)
- 곁글: 언해본 / 한문 / 번역만, 친 분량만큼 색이 차오름
- 영문 입력 감지 경고

**새로 추가**
- 📚 수록 문헌 4편: 훈민정음 어제 서문, 정인지 서문, 용비어천가 1·2장, 세종실록 창제 기사
- ✍️ **내 글로 연습하기**: 원하는 문장을 붙여 넣으면 세로쓰기 연습문으로 추가 (지우기 가능)
- 🏅 **기록 저장**: 완료할 때마다 타수·정확도·시간·급수를 저장, 문헌별 최고 기록 표시
- 📈 결과창에 **시간에 따른 타수 그래프**, **자주 틀린 글자**, 최고 기록 갱신 알림
- ⏸ 다른 창으로 가면 **시간이 멈추고**, 돌아오면 이어짐 (타수가 정확해짐)
- 🔢 누적 오타 (백스페이스로 고친 것까지 셈), 걸린 시간 실시간 표시
- 🌙 **한지 / 먹(다크) 테마**, 시스템 설정 자동 따라가기
- 🔠 글자 크기 3단계
- ⌨️ 단축키: `Esc` 처음부터 · `Ctrl+→/←` 다음/이전 문헌 · 결과창 `Enter` 다음, `Esc` 다시
- 설정과 마지막으로 보던 문헌을 기억 (브라우저 localStorage)

## 새 문헌 넣는 법

`js/lessons.js`의 `LESSONS` 배열에 객체를 하나 추가하면 목록·타자 화면·기록에 자동으로 반영됩니다.

```js
{
  id: 'my-new-book',          // 영문 고유 이름 (기록 저장용)
  era: '정조 · 1795',
  book: '원행을묘정리의궤',
  title: '서문',
  desc: '한 줄 소개',
  about: '출전·해설',
  modern:   ['문장 1', '문장 2'],   // 타자 칠 현대어
  original: ['原文 1', '原文 2']    // (선택) 한문, modern과 같은 개수
}
```

## 다음 개발 권장
1. 원문-번역 구절 단위 짝 데이터 (지금은 위치 비율로 곁글을 배치)
2. 언해본 직접 입력 모드 (옛한글 자판)
3. 실제 공공기관 원문 이미지 연결
4. 왕대/문헌/권/기사 검색, 난이도별 코스
5. 로그인 및 서버에 타자 기록 저장
