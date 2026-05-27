# Design Tokens

> 모든 hex/숫자 값은 디자인 파일에서 추출된 정확한 값입니다.
> Tailwind 사용 시 `tailwind.config.ts`의 `theme.extend`에 매핑하세요.

---

## 1. 컬러 팔레트

### 1.1 페이지 배경 / 표면 (Light Daylight)

```ts
const colors = {
  bg:         '#fbf9f3',  // 페이지 배경 · 따뜻한 아이보리
  bgSoft:     '#f1ede2',  // 한 단계 어두운 크림 (섹션 구분, 빈 영역)
  surface:    '#ffffff',  // 카드 표면
  surfaceHi:  '#fafaf5',  // hover 또는 강조 카드 표면
};
```

### 1.2 텍스트 / 라인

```ts
const text = {
  text:       '#1a1f1c',  // 본문 (거의 검정, 약한 그린톤)
  textDim:    '#5a635f',  // 보조 텍스트
  textFaint:  '#9aa39d',  // 가장 옅은 텍스트 (캡션·메타데이터)
  ink:        '#0d1110',  // 다크 강조 (어두운 섹션 배경)
};

const line = {
  line:        'rgba(13, 17, 16, 0.08)',  // 기본 보더 (8% 잉크)
  lineStrong:  'rgba(13, 17, 16, 0.16)',  // 강조 보더 (16% 잉크)
};
```

### 1.3 브랜드 컬러

```ts
const brand = {
  primary:       '#1a5f3c',                       // 포레스트 그린 · 메인
  primaryHover:  '#185533',
  primarySoft:   'rgba(26, 95, 60, 0.10)',         // 10% tint (배경·필)
  primarySofter: 'rgba(26, 95, 60, 0.05)',          // 5% tint
};
```

### 1.4 액센트 컬러 (목적별)

```ts
const accent = {
  gold:        '#b8893a',                          // 골드 · 강조·하이라이트
  goldSoft:    'rgba(184, 137, 58, 0.14)',
  blue:        '#1f6ba8',                          // 정보·블루
  blueSoft:    'rgba(31, 107, 168, 0.12)',
  purple:      '#7a4ba8',                          // 보조·퍼플
  purpleSoft:  'rgba(122, 75, 168, 0.12)',
  rose:        '#c44d6d',                          // 상담·로즈
  roseSoft:    'rgba(196, 77, 109, 0.12)',
  amber:       '#d68f1a',                          // 경고·앰버
  amberSoft:   'rgba(214, 143, 26, 0.14)',
  danger:      '#d04848',                          // 위험·미납·결석
  dangerSoft:  'rgba(208, 72, 72, 0.10)',
};
```

### 1.5 컬러 사용 규칙

| 컬러 | 의미 / 사용처 |
|---|---|
| **primary** (포레스트) | 출석/완납/긍정 KPI, 메인 CTA, 활성 메뉴 |
| **gold** | 강조 하이라이트, 베타 배지, AI 결과 강조, 신규 |
| **blue** | 정보, 출석률, 학생 상태 (안정) |
| **purple** | 상담 종류 일부, 보조 KPI |
| **rose** | 상담 일정, 학부모 |
| **amber** | 청구 대기, 지각, 경고 |
| **danger** | 미납, 결석, 위험, 긴급 |

---

## 2. Tailwind 매핑 예시

```ts
// tailwind.config.ts
import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // page
        bg:        '#fbf9f3',
        'bg-soft': '#f1ede2',
        surface:   '#ffffff',
        // text
        ink:       '#0d1110',
        text:      '#1a1f1c',
        'text-dim':   '#5a635f',
        'text-faint': '#9aa39d',
        // brand
        primary: {
          DEFAULT: '#1a5f3c',
          hover:   '#185533',
          soft:    'rgba(26, 95, 60, 0.10)',
          softer:  'rgba(26, 95, 60, 0.05)',
        },
        gold:   { DEFAULT: '#b8893a', soft: 'rgba(184, 137, 58, 0.14)' },
        blue:   { DEFAULT: '#1f6ba8', soft: 'rgba(31, 107, 168, 0.12)' },
        purple: { DEFAULT: '#7a4ba8', soft: 'rgba(122, 75, 168, 0.12)' },
        rose:   { DEFAULT: '#c44d6d', soft: 'rgba(196, 77, 109, 0.12)' },
        amber:  { DEFAULT: '#d68f1a', soft: 'rgba(214, 143, 26, 0.14)' },
        danger: { DEFAULT: '#d04848', soft: 'rgba(208, 72, 72, 0.10)' },
      },
      borderColor: {
        DEFAULT: 'rgba(13, 17, 16, 0.08)',
        strong:  'rgba(13, 17, 16, 0.16)',
      },
      fontFamily: {
        sans: ['"Pretendard Variable"', 'Pretendard', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        'card':  '16px',
        'pill':  '999px',
      },
      boxShadow: {
        'card':  '0 1px 3px rgba(13,17,16,0.02)',
        'card-hover': '0 4px 14px rgba(13,17,16,0.04)',
        'primary-glow':  '0 6px 14px rgba(26, 95, 60, 0.22)',
        'primary-deep':  '0 14px 32px rgba(26, 95, 60, 0.28)',
        'modal':  '0 32px 80px rgba(13, 17, 16, 0.08)',
      },
    },
  },
};
```

---

## 3. 타이포그래피

### 3.1 패밀리

```css
/* 본문 */
font-family: "Pretendard Variable", Pretendard, sans-serif;

/* 모노스페이스 (메타데이터, 키보드 단축키, 라벨, 시간) */
font-family: "JetBrains Mono", ui-monospace, monospace;
```

> 임포트:
> `<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css" />`
> `<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap" rel="stylesheet" />`

### 3.2 스케일 (실제 사용된 값)

| 토큰 | px | weight | letter-spacing | 사용 |
|---|---|---|---|---|
| `display-xl` | 96 | 800 | -3px ~ -3.5px | 랜딩 Hero 헤드라인 |
| `display-lg` | 72 / 64 | 800 | -2.4px ~ -2px | 큰 H1 |
| `display-md` | 56 | 800 | -1.8px ~ -1.6px | 섹션 H2 |
| `display-sm` | 48 / 44 / 40 | 800 | -1.6px ~ -1.2px | 작은 섹션 H2 |
| `h1-large` | 32 / 30 | 800 | -1px ~ -0.8px | 화면 hero 제목 |
| `h2` | 24 | 800 | -0.7px | 카드 헤딩 |
| `h3` | 22 / 19 | 800 | -0.5px ~ -0.4px | 작은 헤딩, topbar 제목 |
| `lead` | 18-19 | 500 | — | 리드 카피 |
| `body` | 16 | 500/400 | — | 일반 본문 |
| `body-sm` | 14 | 500 | — | 카드 본문 |
| `body-xs` | 13 | 500/600 | — | 메타·리스트 셀 |
| `caption` | 12 | 500/600 | — | 보조 |
| `micro` | 11 | 700 | 1.5px (uppercase) | 모노 라벨·키커 |
| `tabular` | 26-44 | 800 | -0.6 ~ -1.6 | 숫자 강조 (KPI value) — `font-variant-numeric: tabular-nums` |

### 3.3 라인 높이 가이드

- 본문 (16px) → `line-height: 1.65`
- 리드 (18-19px) → `line-height: 1.6 - 1.75`
- 헤딩 → `line-height: 1.02 - 1.3` (큰 헤딩일수록 짧게)

### 3.4 텍스트 줄바꿈

본문 단락에는 가급적 `text-wrap: pretty` 적용. 한국어 문장은 의도된 `<br />`를 그대로 유지하세요 — 카피 톤의 호흡과 직접 연결됩니다.

---

## 4. 간격 (Spacing)

### 4.1 기본 그리드

- **기준**: 4px (`0.25rem`)
- **선호 값**: `4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 28, 32, 36, 40, 48, 56, 64, 80, 100, 120, 140`
- **컨테이너 외부 패딩**: 64px (1440px 기준)
- **카드 내부 패딩**: 16-24px (작은 카드 16, 일반 18-20, 큰 카드 24-28)

### 4.2 자주 쓰이는 간격

| 용도 | px |
|---|---|
| 인라인 아이콘 ↔ 텍스트 | 6-10 |
| 라벨 ↔ 값 (KPI) | 8-12 |
| 카드 사이 (그리드 gap) | 12-16 |
| 섹션 사이 (블록 마진) | 18-24 |
| Hero 패딩 | 64-92 위/아래 |
| 큰 섹션 패딩 | 100-120 위/아래 |

---

## 5. 모서리 (Border Radius)

| 토큰 | px | 용도 |
|---|---|---|
| `xs`  | 3-4 | 칩, 미니 뱃지 |
| `sm`  | 6-7 | 모노 라벨 박스, 셀 |
| `md`  | 8-10 | 작은 카드, 버튼 |
| `lg`  | 12-14 | 카드, 입력 |
| `xl`  | 16   | 일반 카드 |
| `2xl` | 20   | 큰 카드 |
| `3xl` | 24-28 | Hero / Modal / CTA 박스 |
| `pill` | 999 | 둥근 뱃지, 둥근 버튼 |

---

## 6. 그림자 (Shadows)

```css
/* Card 기본 */
box-shadow: 0 1px 3px rgba(13,17,16,0.02);

/* Card hover/elevated */
box-shadow: 0 4px 14px rgba(13,17,16,0.04);

/* Card with glow (KPI active) */
box-shadow: 0 6px 14px rgba(26, 95, 60, 0.22);  /* primary-glow */

/* Featured / CTA */
box-shadow: 0 14px 32px rgba(26, 95, 60, 0.28); /* primary-deep */

/* Modal / Hero overlay */
box-shadow: 0 32px 80px rgba(13, 17, 16, 0.08);

/* Sidebar active */
box-shadow: 0 6px 16px rgba(26, 95, 60, 0.22);

/* Tile hover */
box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
```

---

## 7. 모션 (Motion)

### 7.1 Reveal on Scroll

```css
@keyframes eywa-reveal-base {
  from { opacity: 0; transform: translateY(40px); }
  to   { opacity: 1; transform: translateY(0); }
}
.reveal      { opacity: 0; transform: translateY(40px); }
.reveal.in   { opacity: 1; transform: translateY(0);
               transition: opacity 0.85s cubic-bezier(.2,.6,.2,1),
                           transform 0.85s cubic-bezier(.2,.6,.2,1); }
.reveal.d1.in { transition-delay: 0.08s; }
.reveal.d2.in { transition-delay: 0.18s; }
.reveal.d3.in { transition-delay: 0.28s; }
.reveal.d4.in { transition-delay: 0.38s; }
```

`IntersectionObserver`로 `threshold: 0.1` 진입 시 `.in` 클래스를 추가합니다. **fallback**: 1.5초 후 자동으로 `.in`을 추가해 어떤 환경에서도 보이지 않는 일을 방지하세요.

### 7.2 로고 마키 (Logo Wall)

```css
@keyframes eywa-mq-l {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
@keyframes eywa-mq-r {
  from { transform: translateX(-50%); }
  to   { transform: translateX(0); }
}
.eywa-mq-track {
  display: flex; gap: 56px;
  animation-duration: 48s;
  animation-iteration-count: infinite;
  animation-timing-function: linear;
  width: max-content;
  align-items: center;
}
.eywa-mq-track.l { animation-name: eywa-mq-l; }
.eywa-mq-track.r { animation-name: eywa-mq-r; }
```

각 트랙은 동일한 아이템을 **두 번 반복**해서 50% 시점에 자연스럽게 루프됩니다. 좌우 끝에 페이드 마스크:

```css
mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
-webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
```

### 7.3 인터랙션 트랜지션

```css
button, a {
  transition:
    background-color 150ms ease,
    color 150ms ease,
    transform 150ms ease,
    box-shadow 200ms ease;
}
```

호버 시 미세한 `transform: translateY(-1px)` 또는 그림자 깊이만 늘리세요. 큰 변형은 피합니다.

---

## 8. 레이아웃 그리드

### 8.1 콘텐츠 폭

| 토큰 | px | 용도 |
|---|---|---|
| `container-narrow` | 720 | 본문 위주 (카피, FAQ) |
| `container-default` | 1100 | 가격, 매니페스토 |
| `container-wide` | 1280 | Hero, Flow, Pricing 그리드 |
| `container-page` | 1440 | 전체 페이지 (외부 패딩 64) |

### 8.2 화면 (앱 내부)

- **사이드바**: 232px (고정)
- **Topbar**: 64px
- **콘텐츠 영역**: `flex: 1`, 패딩 `24px 28px`
- **카드 그리드 gap**: 12-16px

---

## 9. Z-index 레이어

| 토큰 | z-index | 용도 |
|---|---|---|
| `base` | 0 | 기본 |
| `decoration` | 1-2 | 배경 장식 |
| `header-sticky` | 20-30 | sticky nav |
| `dropdown` | 40 | 드롭다운, 컨텍스트 메뉴 |
| `modal` | 50 | 모달, 다이얼로그 |
| `toast` | 60 | 토스트 |
