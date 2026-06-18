# 컴포넌트 가이드 (Components)

> 디자인의 모든 화면은 공통 `AppShell`을 통해 렌더링되며, 그 안의 패턴은 정해진 atoms 조합입니다.
> 코드 위치: `design-files/screens-shell.jsx`

---

## 1. AppShell

```tsx
<AppShell
  active="dashboard"           // 12 메뉴 중 활성 id
  title="대시보드"
  breadcrumb="EYWA · 홈"       // 작은 모노 라벨 (선택)
  actions={<PrimaryButton icon="sparkle">AI 인사이트</PrimaryButton>}
>
  {/* 화면 콘텐츠 */}
</AppShell>
```

### 구조
```
+-------------------------------------------------------+
|  Sidebar (232px)  |  Topbar (64px high)               |
|                   +-----------------------------------+
|                   |                                   |
|                   |  콘텐츠 영역                       |
|                   |  padding: 24px 28px               |
|                   |  overflow: auto                   |
|                   |                                   |
+-------------------+-----------------------------------+
```

### 스타일
- 전체 컨테이너: `background: #fbf9f3`, `font-family: Pretendard Variable`
- 사이드바 / 본문 사이: `1px solid rgba(13,17,16,0.08)`
- Topbar / 본문 사이: 동일

---

## 2. Sidebar

### 구조
```
+--------------------+
| 브랜드 영역 (22 22 18)
|  [logo] EYWA
|         인재원 · 강남
+--------------------+
| HOME              01      <- 그룹 헤더 (모노 11px uppercase)
|   ▣ 대시보드      <- 활성 (forest green bg, white text)
|
| CLASS             02
|     시간표
|     출석부
|     수업목록
|
| STUDENT           03
| ... (반복)
|
+--------------------+
| [김] 김수진          <- 사용자 푸터
|     원장 · master
+--------------------+
```

### 스펙
- **폭**: 232px
- **배경**: `bgSoft (#f1ede2)`
- **오른쪽 보더**: `1px solid line`

### 브랜드 영역
- 패딩: `22px 22px 18px`
- 로고: 28×28 / `border-radius: 7px` / 배경 `ink (#0d1110)`
  - 내부: 16×16 SVG (원 안의 작은 원)
- 워드마크: `EYWA` / 17px / weight 800 / `letter-spacing: -0.4px` / 색 text
- 부제: 10px / 모노 / textDim / `letter-spacing: 0.8px` / `margin-top: 1px`

### 메뉴 그룹 헤더
- 패딩: `6px 12px 4px`
- 폰트: 10px 모노 / weight 400 / `letter-spacing: 1.2px` / uppercase / textFaint
- 좌측에 그룹명 (홈/수업/학생/운영/지원), 우측에 `01/02/03/04/05`

### 메뉴 아이템
- 패딩: `8px 12px`
- `border-radius: 10px`
- 폰트: 13px / 활성은 weight 600, 비활성은 500
- gap: 10px (아이콘 ↔ 라벨)
- **활성 상태**:
  - 배경: `primary (#1a5f3c)`
  - 글자: 흰색
  - 아이콘 박스: 26×26 / `border-radius: 6px` / `rgba(255,255,255,0.16)`
  - shadow: `0 6px 16px rgba(26, 95, 60, 0.22)`
- **비활성**:
  - 배경: transparent
  - 글자: text
  - 아이콘: textDim
- **그룹간 간격**: `margin-bottom: 12px`

### 사용자 푸터
- 패딩: `14px 16px`
- 상단 보더: `1px solid line`
- 배경: `bgSoft`
- 이름: 13px / weight 700
- 역할: 11px / textDim

---

## 3. Topbar

### 구조
```
+------------------------------------------------------+
| [브레드크럼 micro mono]                              |
| [제목 19px 800]                  [검색][알림][액션]   |
+------------------------------------------------------+
```

### 스펙
- 높이: 64px
- 패딩: `0 28px`
- 하단 보더: `1px solid line`
- 배경: `bg (#fbf9f3)`
- `display: flex; align-items: center; justify-content: space-between`

### 좌측 (title + breadcrumb)
- breadcrumb (선택): 11px / 모노 / textDim / uppercase / `letter-spacing: 1px` / `margin-bottom: 3px`
- 제목: 19px / weight 800 / text / `letter-spacing: -0.4px`

### 우측 액션들
- gap: 10px
- 검색바:
  - `min-width: 280px`
  - `padding: 8px 14px` / `border-radius: 999px`
  - 배경 surface / border `1px solid line` / color textDim
  - 좌 검색 아이콘 / 중앙 placeholder 텍스트 / 우 `⌘K` 키 칩
- 알림 버튼:
  - 36×36 / `border-radius: 10px`
  - 배경 surface / border `1px solid line`
  - 우상단 7×7 빨강(`rose`) 점 (안 읽은 표시), `border: 2px solid surface`
- 액션 (옵션): PrimaryButton 또는 GhostButton

---

## 4. Atoms

### 4.1 `<Pill>` (둥근 뱃지)
```tsx
<Pill color={S.primary}>● 진행 중</Pill>
<Pill color={S.amber} soft={false}>긴급</Pill>
```

| 속성 | 값 |
|---|---|
| 패딩 | `3px 8px` |
| border-radius | `999px` |
| 폰트 | 11px / weight 700 / `letter-spacing: 0.3px` |
| 배경 | `soft` 모드: `${color}1f` (약 12%) · 솔리드 모드: 컬러 그대로 |
| 글자색 | `soft` 모드: 컬러 · 솔리드 모드: 흰색 |
| 흔히 같이 쓰는 아이콘 | `●` 점, `▲` 변동, `+` 등 |

### 4.2 `<PrimaryButton>`
```tsx
<PrimaryButton icon="plus">새 학생</PrimaryButton>
```

| 속성 | 값 |
|---|---|
| 패딩 | `9px 16px` |
| border-radius | 10px |
| 배경 | `primary` (또는 prop으로 다른 색 가능) |
| 글자 | 흰색 / 13px / weight 600 |
| shadow | `0 6px 14px ${color}33` |
| icon gap | 6px (아이콘 13px size) |

CTA 버전 (랜딩):
- 패딩 `15px 28px` / border-radius 12 / 폰트 15px / 800
- shadow `0 14px 32px rgba(26, 95, 60, 0.28)`

### 4.3 `<GhostButton>`
```tsx
<GhostButton icon="arrowDown">엑셀 다운로드</GhostButton>
```

| 속성 | 값 |
|---|---|
| 패딩 | `9px 14px` |
| border-radius | 10px |
| 배경 | surface |
| border | `1px solid lineStrong` |
| 글자 | text / 13px / weight 500 |

### 4.4 `<Card>`
```tsx
<Card padding={20} style={{ ... }}>
  ...
</Card>
```

| 속성 | 값 |
|---|---|
| 배경 | surface |
| border-radius | 16px (기본) |
| border | `1px solid line` |
| shadow | `0 1px 3px rgba(13,17,16,0.02)` |
| padding | prop (기본 20px) |

### 4.5 ~~`<Initial>`~~ (제거됨)

이니셜 사각 배지 — **제거됨 (2026-06-19).** 사람 표시는 이름 텍스트만, 이름 앞 아바타 금지.

### 4.6 `<SectionTitle>`
```tsx
<SectionTitle action={<a>모두 보기 →</a>}>오늘의 일정</SectionTitle>
```

- 폰트 14px / 700 / `letter-spacing: -0.2px`
- 우측에 액션 (옵션)
- `margin-bottom: 14px`

---

## 5. KPI 카드 패턴

대시보드/학생목록/수납 등에서 반복되는 KPI 카드.

```
+--------------------+
| LABEL (mono)   icon|     <- 11px uppercase + 26×26 box
|                    |
| 248  명             <- 32px 800 + 12px dim
|                    |
| [+12] 지난 주       <- 11px pill + 11px faint
|                    |
| 신규 14 · 퇴원 2    <- 11px helper (border-top 1px line)
+--------------------+
```

**스펙**:
- 카드 padding: 20px
- 우상단에 100×100 컬러 글로우 (`${color}14`, blur 4px), `position: absolute; top: -30; right: -30; border-radius: 50%`
- 라벨: 11px mono, uppercase, `letter-spacing: 1px`, textDim
- 아이콘 박스: 26×26 / `border-radius: 7px` / `${color}18` 배경 / 컬러 글자
- 값: 32px / 800 / `letter-spacing: -0.8px` / `line-height: 1` / `font-variant-numeric: tabular-nums`
- 단위: 12px dim
- 델타 pill: 11px / 700 / `padding: 2px 7px` / radius 999 / 배경 `primarySoft` 또는 `dangerSoft`
- 헬퍼 텍스트: 14px margin-top + `border-top 1px line + padding-top 12px`

---

## 6. 아이콘 세트

`design-files/eywa-shared.jsx`의 `EyIcon` 컴포넌트가 정확한 stroke SVG 정의를 가지고 있습니다. 그대로 복사하거나, lucide-react로 매핑하세요.

| 이름 | lucide 매핑 (옵션) | 사용처 |
|---|---|---|
| `tree`       | TreePine        | 대시보드 |
| `leaf`       | Leaf            | 시간표, 수업 |
| `pulse`      | Activity        | 출석부 |
| `branch`     | GitBranch       | 수업목록 |
| `seed`       | Wheat           | 학생목록 |
| `sprout`     | Sprout          | 등록상담 |
| `wave`       | Waves           | 학생상담 |
| `falling`    | TrendingDown    | 퇴원관리 |
| `roots`      | Network         | 직원관리 |
| `pollen`     | Coins / Hash    | 수납관리 |
| `rings`      | Disc3           | 회의록 |
| `spore`      | HelpCircle      | 도움말 |
| `search`     | Search          | 공통 |
| `bell`       | Bell            | 공통 |
| `arrowUp`    | ArrowUp         | 변동 |
| `arrowDown`  | ArrowDown       | 변동 |
| `arrowRight` | ArrowRight      | 공통 |
| `play`       | Play            | 데모 |
| `check`      | Check           | 출석 / 액션 |
| `plus`       | Plus            | 추가 |
| `dot`        | Dot             | — |
| `sparkle`    | Sparkles        | **AI 표시 전용 — 일관 사용** |

기본 stroke 1.6, 라운드 cap/join. 색은 currentColor.

---

## 7. 데이터 테이블 패턴

수납관리, 학생목록, 출석부 등에서 사용.

```
+--------------------+ Card padding=0
| Header row         | 12px 18px / line bottom
| [chk] STUDENT  ...|  11px mono uppercase
+--------------------+
| [I] 강민서  ...   | 12px 18px / line between rows
| [I] 윤소율  ...   |
| ...                |
+--------------------+
| Pagination foot    | 12px 18px / fontSize 12 textDim
+--------------------+
```

- 헤더: `display: grid; grid-template-columns: ...; padding: 12px 18px; border-bottom: 1px solid line; font-size: 11px; color: textFaint; font-family: mono; letter-spacing: 1px; text-transform: uppercase;`
- 행: 같은 grid + `padding: 12px 18px; border-bottom: 1px solid line` (마지막 행은 none) + `font-size: 13px`
- 행 내부 폰트: 학생명 weight 600, 보조 정보 textDim 12px

---

## 8. 진행바 (Progress)

```css
.track { height: 6-10px; background: bgSoft; border-radius: 999px; overflow: hidden; }
.fill  { height: 100%; background: primary; }
```

다중 색 (수납 진행률):
```jsx
<div style={{ display: 'flex', height: 10, ... }}>
  <div style={{ width: '87.1%', background: primary }} />
  <div style={{ width: '9.7%',  background: amber }} />
  <div style={{ width: '3.2%',  background: danger }} />
</div>
```

---

## 9. 인용 카드 (Testimonial)

```
+--------------------+
| [큰 따옴표 SVG]      <- 단, 텍스트 " 사용 X
|                    |
| "본문 26px 500..." |
|                    |
| ─────              |
| [김] 김수진 원장    | 우측: ★★★★★ gold
|     인재원 · 강남  |
+--------------------+
```

- 따옴표는 SVG 또는 큰 폰트 ("." 사용 금지 — 디자인에서 ASCII 쌍따옴표 마음에 안 든다고 함)
- 왼쪽에 4px 컬러 액센트 스트라이프 (`background: primary`)

---

## 10. AI 강조 패턴

AI가 등장하는 곳 (등록상담 · 학생상담 · 회의록):

```
+----------------------------------------+
| [icon glow]                            |
|                                        |
| POWERED BY CLAUDE                       <- gold #e9c876 mono
| AI가 등록상담을 듣고, 학습 스타일을      <- 17 800
| 정리합니다.                              |
| 본문...                                |
|                            [이번달 87회] <- 흰 글래스 칩
+----------------------------------------+
```

- 배경: `linear-gradient(135deg, #1a5f3c 0%, #2a7a52 100%)` (포레스트 그라데이션)
- 우상단에 동심원 SVG 장식 (`opacity: 0.18`)
- 아이콘 박스: 52×52 / `border-radius: 14px` / `rgba(255,255,255,0.18)` / sparkle 아이콘 24px
- 키커 색: `#e9c876` (밝은 골드, 다크 위에서 잘 보임)
- shadow: `0 14px 32px rgba(26, 95, 60, 0.20)`

---

## 11. 라이브 / 실시간 표시

- 빨강(`danger`) 8px 원 + 4px 외곽 페이드 (`box-shadow: 0 0 0 4px dangerSoft`)
- 또는 작은 펄싱 점
- "LIVE" 라벨은 모노 / 700 / uppercase / 빨강 배경 / 흰 글자

---

## 12. 마키 (LogoWall)

`tokens § 7.2` 참조. 워드마크는:
- 폰트 20-22px / weight 700 / `letter-spacing: -0.6px` / `color: textFaint`
- 같은 트랙에 동일 아이템 두 번 반복
- 4행, 좌우 교차 (r-l-r-l)

---

## 13. CTA 박스 (랜딩)

```
+------------------------------------------+
| BETA OPEN · 신규 등록 진행중              <- pill
|                                          |
| 오늘 신청하면                             |
| [다음 주에 적용]됩니다.                   <- gold underline
|                                          |
| 본문...                                  |
|                                          |
| ─────                                    |
| ✓ 신용카드 없이 무료 시작                  |
| ✓ 평일 1시간 안 응답 보장                  |
| ✓ 데이터 무료 마이그레이션                  |
+------------------------------------------+
        |
[ 베타 신청하기  →   ]  <- forest gradient pill card
[ 원장님과 30분 상담 ]  <- cream outline pill card
   1670-0000 · 평일 10:00–18:00
```

- 컨테이너 `max-width: 1100px`, `padding: 64 56`, `border-radius: 28`
- 배경 surface, border `1px solid line`, shadow `0 32px 80px rgba(13, 17, 16, 0.08)`
- 우상단 + 좌하단에 컬러 라디얼 글로우 + 우상단에 동심원 SVG (트리링)
- 액션 카드 2개 (Primary + Secondary), 각각 라벨("3분이면 끝") + 큰 제목 + 화살표 박스

---

## 14. 동그란 프로필 사진 금지 ❗

피드백: **"'김' 같은 동그란 프로필사진 필요없음"** → 이후 이니셜 배지(`Initial`)도 제거(2026-06-19).

**규칙**: 사람 표시는 **이름 텍스트만**. 이니셜 사각 배지·동그란 프사·이미지 아바타 모두 금지(이름 앞/옆에 새로 붙이지 말 것). 색 구분이 필요하면 텍스트 색/Pill로.
