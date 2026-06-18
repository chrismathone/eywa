# 랜딩 페이지 상세 가이드

> `design-files/EYWA Landing.html` + `landing-network.jsx`
> 픽셀 정확한 값은 JSX 코드 참조.

---

## 0. 전체 구조

```
[Nav (sticky)] 64h
[Hero]
[Flow — 한 번의 액션, 모두에게 흐른다]
[LogoWall — Live Network · 라이트 톤]
[Manifesto — EYWA의 핵심가치는 학원의 성장입니다]
[Testimonials — Featured + 3 quotes]
[Pricing — 베타 3 plans]
[CTA — 다음 주에 적용됩니다]
[Footer]
```

페이지 배경: `#fbf9f3` (bg)
공통 패딩: 외부 `0 64px`, 컨테이너 `max-width: 1100-1280px`

---

## 1. Nav (sticky)

- 패딩 `18px 64px`
- 보더 하단 `1px solid line`
- 배경 `bg`
- `position: sticky; top: 0; z-index: 30`

좌측:
- 로고 (28×28, radius 8, primary bg, 흰 내부 SVG)
- 워드마크 `EYWA` (19px 800)
- 메뉴: `기능 소개 · 요금 안내 · 도입 사례 · 고객 지원 · 회사 소개` (gap 24, 14px textDim weight 500)

우측:
- `로그인` 14 weight 500 text
- 버튼 `무료로 시작하기` (10 18 radius 999 primary bg 흰 글자 14 weight 600)

---

## 2. Hero

- 패딩 `64px 64px`
- grid `1.1fr : 1fr`, gap 56, align center

### 좌측

1. **배지** (`primarySoft` bg + primary 글자, padding 6px 14px, radius 999, 12 weight 600):
   - `[sparkle] 전국 47개 학원이 선택한 학원관리 프로그램`

2. **헤드라인** (56px weight 800, `letter-spacing: -1.8`, line-height 1.15):
   ```
   원장님이 가장 먼저 켜는
   [학원관리 프로그램]    ← primary 색
   ```

3. **본문** (17px line-height 1.7 textDim, max-width 460):
   ```
   출결 · 수납 · 상담 · 학부모 알림까지
   학원 운영에 꼭 필요한 모든 기능을 한 화면에서.
   [월 49,000원부터, 첫 달은 무료]입니다.
   ```
   강조 부분만 text + weight 700

4. **CTA 2개 + 소셜 프루프**:
   - 주 버튼: padding `14px 24px`, radius 12, primary bg, 흰 글자, 14 weight 700, shadow `0 6px 16px rgba(31,122,77,0.25)`
     - 텍스트: `무료로 시작하기`
   - 보조 버튼: surface bg + lineStrong border, radius 12, 14 weight 600
     - 텍스트: `요금 안내 →`
   - 우측 시계 32 + 소셜 프루프:
     - 4개 컬러 정사각형 28 (border-radius 50% 가능 — 단, **사람 이미지가 아니라 추상 색**)
     - 텍스트: `이미 47개 학원이 사용하고 있어요` + `★★★★★ 4.9 · 원장님 92%가 추천`

### 우측 — Hero 플로팅 카드

배경: `linear-gradient(135deg, primary 0%, #2d9461 100%)` (그린 그라데이션)
- radius 24, padding 24, shadow `0 20px 60px rgba(31,122,77,0.25)`

내부 3개 카드 (회전 `-1.5deg → 1deg → -0.5deg`, gap 14):

1. **오늘의 학원** (실시간 dot):
   - 3개 KPI 미니 (재원생 248 / 출석률 94.2% / 수납률 87.1%)
   - 카드: padding 16, radius 14, surface bg, shadow `0 10px 30px rgba(0,0,0,0.12)`

2. **오늘 진행중** (수업 정보):
   - 좌측 leaf 아이콘 박스 (primarySoft) + 우측 LIVE pill

3. **윤소율 학부모 상담 완료**:
   - 본문 + `방금` (primary 11 600)

---

## 3. Flow — "한 번의 액션, 모두에게 흐른다"

배경: `bgSoft` · 패딩 `120px 64px` · 보더 위아래

`max-width: 1280px` · grid `380px : 1fr` gap 80

### 좌측 (sticky 가능)
- 키커 (`<Eyebrow>` 11 weight 700 primary uppercase): `01 — 연결`
- H2 (56 800, `letter-spacing: -1.8`):
  ```
  한 번의 액션,
  [모두에게 흐른다.]  ← primary
  ```
- 본문 (16 textDim line-height 1.75, max-width 360):
  > 학생이 학원에 들어선 그 순간, 학부모·강사·원장·회계까지 동시에 연결됩니다. 따로 입력하지 않아도, 따로 알리지 않아도.

### 우측 — 데이터 플로우 시각화

#### Trigger 카드
- surface bg, radius 16, padding `22px 28px`, shadow `0 16px 36px primary08`
- **좌측 4px primary 액센트 스트라이프** (절대 위치)
- 좌 48×48 primary 아이콘 박스 (check, shadow `0 6px 16px primarySoft`)
- 본문:
  - `오후 4:02 · 트리거` (mono 11 primary uppercase weight 700)
  - `강민서 학생이 등원했습니다.` (18 700 letter-spacing -0.3)
- 우 `1 EVENT` pill (primarySoft + primary)

#### 분기 화살표 (56px 높이)
SVG로 4개 곡선 + 끝점 색 원:
```
trigger → ↘  ↘  ↗  ↗ → 4개 카드
```
각 곡선: `M 400 0 Q 400 28 X 28 L X 56` (X = 0.125, 0.375, 0.625, 0.875 × 800)

#### Outcomes 4개 카드
| 태그 | 본문 | 색 |
|---|---|---|
| → 학부모 | 카카오톡으로 등원 알림이 즉시 전송됩니다. | gold |
| → 강사 | 담당 강사의 출석부에 자동으로 체크됩니다. | primary |
| → 원장 | 대시보드 출석률 KPI가 실시간으로 갱신됩니다. | blue (#1f6ba8) |
| → 회계 | 수업 잔여 차감과 수강료 처리가 자동으로 이루어집니다. | purple (#7a4ba8) |

각 카드: surface bg, radius 14, padding 18, **border-top: 3px solid 색**, 1px line 외곽.

#### Realtime 확인 칩 (마지막)
- inline-flex chip: `[● 0.4초 안에 동기화 완료]` · `Supabase Realtime`
- surface bg + line 보더, radius 12, padding `14px 20px`

---

## 4. LogoWall — Live Network (라이트 톤)

배경: `bgSoft` · 보더 위아래 · 패딩 `120px 0 110px`

### 백그라운드 장식
- 좌상단 520×520 radial primarySoft 글로우
- 우상단 540×540 radial goldSoft 글로우 (opacity 0.8)
- 전체에 옅은 40×40 그리드 패턴 (8% ink stroke, opacity 0.5)

### 헤더 (`flex space-between` 정렬)
좌측:
- 키커: `[─] LIVE NETWORK` (11 weight 700 primary uppercase letter-spacing 2)
- H2 (44 800, `letter-spacing: -1.4`):
  ```
  지금 이 순간에도
  전국 [47개 학원이] EYWA를 쓰고 있어요.
  ```
  47 부분만 gold underline (`box-decoration-break: clone` 기법, `linear-gradient(transparent 62%, goldSoft 62%, goldSoft 92%, transparent 92%)`)

우측 (실시간 표시 칩):
- surface bg + line 보더, radius 999, padding 8 14, shadow 약함
- 텍스트: `[● primary glow] Supabase Realtime · 2026.05.27 14:32`
- 11 mono uppercase primary

### 라이브 카운터 4개 (그리드 4컬럼, gap 16)

```ts
[
  { label: '오늘 출석 체크',    value: '12,847', sub: '실시간 누적',  color: primary },
  { label: '학부모 알림 발송',  value: '8,326',  sub: '카톡 + 푸시',  color: blue (#1f6ba8) },
  { label: '진행 중 상담',      value: '142',    sub: '17개 학원',    color: purple (#7a4ba8) },
  { label: '함께하는 학원',     value: '47',     sub: '전국',          color: gold },
]
```

각 카드:
- surface bg, line 보더, radius 16, padding 24, shadow card-hover
- 우상단 110×110 컬러 글로우 (`${color}1f`, blur 8)
- 헤더: 라벨 (11 mono uppercase textDim) + LIVE 미니 pill (`${color}18`, weight 700, `[● color] LIVE`)
- 값: 44 weight 800 text `letter-spacing: -1.6` mono tabular
- 부제: 12 textDim margin-top 8

### 학원 모자이크 — 함께 만들어가는 학원들

상단 미니 라벨: `[● gold] 함께 만들어가는 학원들 · 10/47` (11 mono uppercase textDim)

그리드 `repeat(12, 1fr)` gap 10, 각 타일은 span 다양 (4/3/5/3/4/5/3/3/3/3):

```ts
const tiles = [
  { name: '청솔학원',  loc: '경기 분당',    students: 312, span: 4, accent: true },
  { name: 'MS어학원',  loc: '경기 일산',    students: 187, span: 3 },
  { name: '명문국어',  loc: '서울 강남',    students: 240, span: 5 },
  { name: '수림수학',  loc: '서울 잠실',    students: 198, span: 3 },
  { name: '하이클래스', loc: '서울 목동',    students: 156, span: 4 },
  { name: '에듀온',    loc: '부산 해운대',  students: 421, span: 5, accent: true },
  { name: '베스트영어', loc: '대구 수성',    students: 168, span: 3 },
  { name: '인재원',    loc: '서울 강남',    students: 248, span: 3 },
  { name: '드림에듀',  loc: '대전 둔산',    students: 134, span: 3 },
  { name: '큐브어학원', loc: '광주 상무',    students: 92,  span: 3 },
];
```

각 타일:
- 일반: surface bg, line 보더, radius 14, padding 18, height 116
- **accent (강조)**: primary 그라데이션 `linear-gradient(135deg, primary 0%, #2a7a52 100%)`, 흰 글자, shadow `0 14px 32px primary20`
- 상단: 이름 16 800, 위치 11 textDim
- 하단: 학생수 22 800 (accent는 흰색, 일반은 primary) + `학생` (10 mono) + ACTIVE pill

### 푸터 status bar
- surface bg + line 보더 + radius 12 + padding `14px 20px`
- 좌: `// 전국 47개 학원 · 12,800+ 학생 · 220+ 강사` (12 mono textDim)
- 우: `uptime 99.97% · SLA 99.9%` (primary 강조)

---

## 5. Manifesto — EYWA의 핵심가치는 학원의 성장입니다

배경: `bg` · 패딩 `140px 64px 120px`

### 헤더
- 키커 `02 — 약속`
- H2 (56 800):
  ```
  EYWA의 핵심가치는
  [학원의 성장]입니다.   ← goldSoft underline (box-decoration-break clone)
  ```
- 본문: `기술이 아닌 학원을 위한 도구. EYWA가 매일 지키는 다섯 가지 약속입니다.` (16 textDim)

### 5개 카드 — 벤토 그리드

`grid-template-columns: repeat(6, 1fr)`, span: `3, 3, 2, 2, 2`

```ts
const items = [
  { no: '01', title: '운영은 쉽게, 교육은 깊게.',
    body: '청구서 자동 생성, 미납 관리, 출결 체크, 상담 기록까지\n매일 반복되는 일은 EYWA가 합니다.',
    accent: primary, icon: 'roots' },
  { no: '02', title: '더 많은 기능이 아닌, 더 깊은 이해.',
    body: '학부모와 진짜로 소통하고 강사와 매끄럽게 연결됩니다.\n학원 운영을 진심으로 이해하는 도구.',
    accent: gold, icon: 'wave' },
  { no: '03', title: '원장님의 한마디가 로드맵.',
    body: '실제로 운영해본 원장님의 제안만이\n다음 버전의 EYWA를 만듭니다.',
    accent: blue, icon: 'check' },
  { no: '04', title: '처음부터 끝까지 함께.',
    body: '학생 한 명으로 시작할 때도, 분원을 늘릴 때도,\nEYWA는 같은 자리에서 같은 약속을 지킵니다.',
    accent: purple, icon: 'rings' },
  { no: '05', title: '중요한 일에 집중할 수 있도록.',
    body: '수업, 상담, 마케팅. 학원을 키우는 일에 집중하세요.\n나머지는 EYWA에게 맡기세요.',
    accent: rose, icon: 'sparkle' },
];
```

각 카드:
- surface bg, line 보더, radius 20, padding `32px 32px 28px`
- 우상단 240×240 컬러 라디얼 워시 (`${accent}` 10-12% tint)
- 상단: PROMISE pill (`[01 white circle] PROMISE`) + 우측 40×40 컬러 아이콘 박스
- 제목 24 800, line-height 1.3
- 본문 14 textDim line-height 1.7 (whitespace pre-line)
- 푸터: `01 / 05` (10 mono uppercase textFaint) + 우측 24×1 컬러 라인

---

## 6. Testimonials — 원장님들의 진짜 이야기

배경: `bg` · 패딩 `120px 64px`

### 헤더
- 키커 `03 — 도입 사례`
- H2 `원장님들의 진짜 이야기.` (52 800)

### Featured 인용 (큰 카드)
- surface bg, line 보더, radius 24, padding `48px 56px`
- grid `1fr : 320px` gap 56 (좌측 인용, 우측 메트릭 패널)
- **좌측 4px primary 액센트 스트라이프**

좌측:
- 인용 표시 (커스텀 SVG, **ASCII 쌍따옴표 사용 금지**):
  ```
  [SVG 99-shape primary]
  ```
- 본문 (26 weight 500, line-height 1.5, letter-spacing -0.5, text-wrap pretty):
  > EYWA를 도입한 이후 출결 관리가 완전히 달라졌습니다. 예전엔 수기로 체크하느라 시간도 많이 들고 누락도 잦았는데, 이제는 학생이 등원만 해도 자동으로 출결이 기록되고 학부모에게 알림이 바로 전송됩니다.
- 푸터 (border-top 1px line padding-top 24):
  - 좌: 이름 `김수진 원장` 15 700 + 학원/지역 `새봄가우스 수학학원 · 경기 남양주`
  - 우: ★★★★★ (gold)
  - **아바타/아이콘 사용하지 않음** — 텍스트만 (사용자 요청)

우측 메트릭 패널:
- bgSoft bg, line 보더, radius 16, padding 28
- 키커 `도입 효과` (mono primary)
- 큰 숫자 `28%` (44 800)
- 본문 `월 평균 행정시간 감소`
- 부제 `6개월 실측 평균` (11 mono textFaint)
- 3줄 (border-top line):
  - `출결 누락` ↔ `0건`
  - `학부모 항의` ↔ `-80%`
  - `신규 등록 전환` ↔ `+17pt`

### Others — 3개 작은 인용 (그리드 3컬럼 gap 16)
시드:
```ts
const others = [
  { quote: '자동청구서 기능 덕분에 매달 청구 업무가 간단해졌습니다. 수강료가 자동 계산되어 청구되니 실수가 줄고, 학부모도 청구 내역을 명확히 확인할 수 있습니다.',
    name: '박정호 원장', academy: '바른스터디', loc: '서울 강북구' },
  { quote: '출결앱과 학부모앱을 추가 비용 없이 사용할 수 있어 부담이 없었습니다. 학부모가 자녀의 출결과 알림을 직접 확인할 수 있어 신뢰가 높아졌습니다.',
    name: '이연우 원장', academy: '티클래스 호평', loc: '경기 남양주' },
  { quote: '상담 내용이 AI로 자동 정리되고, 필요한 안내는 바로 메시지로 전달할 수 있어 업무 효율이 매끄럽습니다. 학부모 응대가 훨씬 수월해졌습니다.',
    name: '정민호 원장', academy: '유클리드', loc: '경기 의정부' },
];
```

각 카드:
- surface bg, line 보더, radius 16, padding `28px 28px 24px`
- 상단: ★★★★★ (gold)
- 본문 14.5 weight 500, text-wrap pretty
- 푸터 (border-top line padding-top 16): 이름 13 700 + 학원/지역 12 textDim (아바타 없음)

---

## 7. Pricing — 정식 출시까지, 모든 플랜은 베타

배경: `bgSoft` · 패딩 `120px 64px`

### 헤더 (`flex space-between` align flex-end)
좌측:
- 키커 `04 — 요금`
- H2 (48 800):
  ```
  정식 출시까지,
  모든 플랜은 [베타].   ← gold
  ```
우측 — Beta Notice 카드 (max-width 320):
- goldSoft bg + `1px solid gold55` border, radius 12, padding 18
- 키커 (gold mono weight 800): `[● gold] Beta Notice`
- 본문 13 weight 500:
  ```
  현재 EYWA는 베타 운영 중입니다.
  정식 출시 후 가격이 변동될 수 있습니다.
  ```

### 3개 플랜 (그리드 3컬럼 gap 16)

```ts
const plans = [
  { name: '스타터',         sub: '시작하는 학원에',     features: ['재원생 50명까지', '12개 메뉴 전체', '학부모 카톡 알림'] },
  { name: '프로',           sub: '대부분의 학원에 적합', features: ['재원생 무제한', 'AI 상담분석 월 100회', '카카오 비즈톡', '전화 지원'], highlight: true },
  { name: '엔터프라이즈',   sub: '대형 · 분원 학원에',   features: ['분원 통합 관리', 'AI 분석 무제한', '전담 매니저', 'SLA 99.9%'] },
];
```

각 카드:
- surface bg, radius 20, padding `32px 28px`
- **highlight (프로)**: 2px primary 보더, primary 글로우 shadow, 우상단에 160×160 primarySoft 라디얼 워시
- 상단: 이름 18 800 + (highlight면) 가장 인기 pill (primary bg 흰 글자 10 800)
- 부제 13 textDim
- **베타 가격 블록**:
  - BETA pill (`[β white circle] BETA`) goldSoft bg gold 글자
  - 값 `무료` 40 800 + `· 베타 기간` (13 textDim)
  - 보조 `정식 출시 후 가격이 변동될 수 있습니다.` (11 textFaint)
- 버튼 `베타 신청하기`:
  - highlight: primary bg 흰 글자 shadow
  - 그 외: surface bg + lineStrong 보더, text 글자
- 기능 리스트 (border-top line padding-top 20):
  - 각 항목: 13, primary 체크 아이콘 + 라벨

---

## 8. CTA — 다음 주에 적용됩니다 (라이트 톤)

배경: `bg` · 패딩 `120px 64px`

박스:
- max-width 1100, padding `64px 56px`, radius 28
- surface bg, line 보더, shadow `0 32px 80px rgba(13,17,16,0.08)`

### 백그라운드 장식 (`position: absolute` overflow hidden)
- 우상단 520×520 primary 라디얼 워시 (15% tint)
- 좌하단 440×440 gold 라디얼 워시 (14% tint)
- 우상단 700×700 SVG 동심원 (4개 원, primary 1px stroke, opacity 0.18) — 트리링 모티프

### 콘텐츠 grid `1.3fr : 1fr` gap 56

#### 좌측
- BETA OPEN 배지 (primarySoft + primary 글자, padding 6 14 radius 999):
  - `[● primary glow] BETA OPEN · 신규 등록 진행중`
- H2 (48 800, `letter-spacing: -1.6`):
  ```
  오늘 신청하면
  [다음 주에 적용]됩니다.   ← goldSoft underline + primary 글자
  ```
- 본문 (16 textDim line-height 1.75, max-width 480):
  ```
  상담 30분 · 데이터 마이그레이션 3일 · 직원 교육 2일.
  다음 주 월요일에는 EYWA가 켜져 있습니다.
  ```
- Trust strip (border-top line padding-top 24, gap 28 flex):
  3개 항목, 각 22×22 primarySoft check 아이콘 + 라벨/제목:
  - `신용카드 없이` / `무료 시작`
  - `평일 1시간 안` / `응답 보장`
  - `데이터` / `무료 마이그레이션`

#### 우측 — 액션 카드 2개 + 전화

**주 액션** (큰 그라데이션 카드):
- `linear-gradient(135deg, primary 0%, #2a7a52 100%)` 배경, 흰 글자, radius 16, padding `20px 24px`
- shadow `0 14px 32px primary28`
- 좌측 텍스트: `[3분이면 끝]` (11 weight 800 letter-spacing 1.5 white70) + `베타 신청하기` (17 800)
- 우측 40×40 라운드 박스 (`rgba(255,255,255,0.18)`) + 흰 화살표 아이콘

**보조 액션** (크림 outline):
- bgSoft 배경 + line 보더, radius 16, padding `18px 24px`
- 좌측 텍스트: `[편하게 물어보세요]` (textDim) + `원장님과 30분 상담` (15 700)
- 우측 36×36 박스 (surface bg + primary 글자 + line 보더) + 수화기 아이콘 SVG

**전화 힌트** (중앙 정렬, marginTop 4):
- `1670-0000` (mono weight 600 text) · `평일 10:00 – 18:00` (textDim)

---

## 9. Footer

- 패딩 `32px 64px`
- 보더 상단 `1px solid line`
- `display: flex; justify-content: space-between`
- 좌측: 18×18 로고 + `© 2026 EYWA · 인재원 학원관리`
- 우측 링크 4개: `이용약관 · 개인정보처리방침 · 사업자 정보 · 고객지원`
- 폰트: 12 textDim

---

## 스크롤 등장 적용 위치

`.eywa-reveal` 클래스로 다음 요소들에 적용:
- Hero 좌측 텍스트 그룹 (4단계 stagger)
- Hero 우측 플로팅 카드 (delay 2)
- Flow 좌측 헤더, 우측 trigger, 4 outcomes (개별 stagger)
- LogoWall 헤더, 4 카운터, 10 타일, 푸터 (개별 stagger)
- Manifesto 헤더, 5 카드 (개별 stagger)
- Testimonials 헤더, featured, 3 others (개별 stagger)
- Pricing 헤더, 3 카드 (개별 stagger)
- CTA 박스

세부 키프레임/transition은 `DESIGN_TOKENS.md § 7.1` 참조.
