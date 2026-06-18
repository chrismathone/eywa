# 12개 화면 상세 가이드

> 각 화면은 `<AppShell>`로 감싸고, 그 안에 콘텐츠 영역이 들어옵니다.
> 정확한 px/색/카피는 `design-files/screens-{a,b,c}.jsx`에서 확인.

화면별로 다음 정보를 제공합니다:
- **목적**: 사용자가 여기서 무엇을 하는가
- **레이아웃**: 박스 모델, 그리드 구조
- **컴포넌트**: 각 영역의 자세한 스펙
- **데이터**: 필요한 필드들
- **동작**: 인터랙션·상태

---

## 1. 대시보드 — `/`

### 목적
원장이 매일 아침 5분 안에 학원의 어제·오늘 상태를 파악.

### Topbar
- breadcrumb: `EYWA · 홈`
- 제목: `대시보드`
- actions: `<PrimaryButton icon="sparkle">AI 인사이트</PrimaryButton>`

### 콘텐츠 구조
```
1) Greeting Card (24px 28px)        ── 전체 폭
2) KPI 4개 그리드 (gap: 14)          ── 4컬럼
3) Timeline + Announcements         ── 1.55fr : 1fr
```

### 1.1 Greeting Card
- `<Card padding="24px 28px">` + `position: relative; overflow: hidden`
- 우상단 220×220 트리링 SVG 장식 (5개 원, opacity 0.5)
  - 중앙 10px gold 점
- 키커: `2026 · 05 · 27 · 水 · 학원 17일째` (11px primary mono uppercase)
- H1: `안녕하세요, [김수진] 원장님.` (30px 800, "김수진"만 primary 색)
- 본문: `오늘 출석률은 평소보다 1.8pt 올랐어요. 수납률이 살짝 떨어졌으니 미수금 32건은 한번 살펴보세요.` (13px textDim · max-width 540)

### 1.2 KPI 카드 4개
```ts
[
  { label: '재원생',         value: '248',  unit: '명',  delta: '+12',    up: true,  helper: '신규 14 · 퇴원 2',     color: primary, icon: 'seed'   },
  { label: '오늘 출석률',     value: '94.2', unit: '%',   delta: '+1.8pt', up: true,  helper: '234/248 · 결석 9',     color: blue,    icon: 'pulse'  },
  { label: '이번달 수납률',   value: '87.1', unit: '%',   delta: '-2.4pt', up: false, helper: '216/248 · 미수 32',     color: gold,    icon: 'pollen' },
  { label: '진행중 상담',     value: '11',   unit: '건',  delta: '+3',     up: true,  helper: 'AI 분석 대기 4',       color: purple,  icon: 'sprout' },
]
```
세부 스펙은 `COMPONENTS.md § 5` 참고.

### 1.3 Timeline (1.55fr)
- `<Card padding={0}>` (헤더와 본문 영역 분리)
- 헤더:
  - 좌측: 키커 `오늘 · 5월 27일` (primary mono) + 제목 `오늘의 일정` (17px 700)
  - 우측: `<Pill color={rose}>● 진행 중 1건</Pill>`
- 본문 (`padding: 6px 22px 18px`): 일정 6개 (시드 데이터 참조)
  - 행 구조: `[시간 컬럼 54px] [일정 카드]`
  - 시간: 12px mono + 작은 분 (`{e.mins}분`)
  - 일정 카드: `border-radius: 12px`, `padding: 10px 14px`
    - 진행중: `background: ${color}0d`, `border: 1.5px solid ${color}`
    - 완료: `opacity: 0.55`
    - 그 외: `background: bgSoft`, `border: 1px solid line`
  - 좌측 아이콘 32×32 (`${color}1f` 배경)
  - 우측 강의실 11px mono textFaint
- 타입 매핑:
  - class: primary + `leaf`
  - consult: rose + `wave`
  - meeting: amber + `rings`

### 1.4 Announcements (1fr)
- 헤더: 키커 `공지` (amber mono) + 제목 `최근 알림`
- 우측: `<GhostButton icon="plus">새 공지</GhostButton>`
- 본문: 공지 3건 (시드: 김수진 원장 · 운영팀 · 인사)
- 각 행: pill (공지/시스템/인사 색상 차등) + 시간(모노 11) + 제목(13px 600) + 작성자(11px textDim)

---

## 2. 시간표 — `/timetable`

### 목적
주간 시간표 보기 + 드래그로 반 이동 (드래그는 P1+).

### Topbar
- 제목: `시간표` / breadcrumb: `EYWA · 수업 · 시간표`
- actions: `[GhostButton 이번 주] [PrimaryButton 수업 추가]`

### 1) 필터 strip (마진 18)
- `padding: 12px 18px` / `border-radius: 12px` / surface / border
- 좌측: 날짜 범위 `2026.05.25 — 05.30` (12px mono textDim)
- 우측: 컬러 범례 5개 (수업·영어·국어·특강·회의), 각 11px mono + 8×8 컬러 dot
- 끝: GhostButton 필터

### 2) 시간표 그리드
- `<Card padding={0} overflow:hidden>`
- 헤더 행 (36px high, background bgSoft):
  - 좌측 60px 빈칸 + 6일 컬럼 (월~토)
  - 각 요일: gap 6, `요일` + 일자 (모노 11px)
  - **오늘 (수)** 하이라이트: 배경 `primarySofter`, primary 색
- 본문 그리드:
  - 좌측 60px: 시간 라벨 (14:00 ~ 21:00, 한 시간당 56px)
  - 6일 컬럼: 각 8시간 × 56px = 448px 높이
  - 오늘 컬럼 위에 옅은 그린 배경 (`${primary}06`)
  - 시간 셀: `border-bottom: 1px solid line`

### 3) 수업 블록
- 절대 위치, `top = start * 56px + 4`, `height = span * 56px - 8`
- 일반: `${color}14` 배경, `${color}30` 보더, `border-left: 3px solid ${color}`
- **진행 중 (current)**: 솔리드 색 배경, 흰 글자, `shadow: 0 6px 16px ${color}55`
- 미니 (회의 등): `padding: 4px 8px`만, 제목만 표시
- 내부: 제목 12px 700 + 강의실/강사 10px mono + 학생수 (`● 12명`) 10px 600
- "NOW" 라벨: 진행중일 때 우상단에 9px mono `rgba(255,255,255,0.22)` 칩

### 시드 블록 (`screens-a.jsx` 참조 — 총 13개)
- 월 14:00-16:00 중2 수학 심화 A (301호, 박지훈, 12명)
- 월 17:00-19:00 고1 영어 정규 B (205호, 이연우, 10명)
- 화 15:00-17:00 중3 수학 심화 C
- … (총 13개)

---

## 3. 출석부 — `/attendance`

### 목적
주간 학생 출결을 표로 확인, 일괄 체크.

### Topbar
- actions: `[GhostButton 엑셀 다운로드] [PrimaryButton 일괄 체크]`

### 1) Stat strip (4개)
| 라벨 | 값 | 색 |
|---|---|---|
| 이번 주 평균 | 94.2% (+1.8pt pill) | primary |
| 오늘 출석 | 234 / 248명 | blue |
| 결석 | 9명 · 학부모 알림 발송 | danger |
| 지각 | 5명 | amber |

### 2) 반 필터 칩
- pill 4개: 중2 수학 심화 A (활성, 솔리드 primary) · 중3 수학 심화 C · 고1 영어 정규 B · 고2 국어 정규 (모두 surface + line)
- 우측: GhostButton `학생 검색`

### 3) 출석 테이블
- 헤더: `40px [학생 1.4fr] [학년 80px] [월 25] [화 26] ... [토 30] [출석률 80px]` grid
- 출결 마크 셀: 28×28 정사각형 (`border-radius: 8px`)
  - O (출석): primarySoft bg + primary 색
  - X (결석): dangerSoft bg + danger 색
  - L (지각): amberSoft bg + amber 색
  - `-` (휴일/N/A): transparent + textFaint
  - 폰트 12px 700 mono
- 출석률: 우측 정렬, 14px 700, 색:
  - ≥90% → primary
  - ≥80% → amber
  - <80% → danger

### 시드 학생 10명 (`screens-a.jsx` 참조)
강민서, 윤소율, 이도현, 한지우, 정수아, 김도윤, 박서진, 최예준, 신아린, 장유나 — 모두 중2 · 수학 심화 A반

---

## 4. 수업목록 — `/classes`

### 목적
모든 반을 카드로 한눈에, 정원/강사/시간 파악.

### Topbar
- actions: `[GhostButton 필터] [PrimaryButton 새 반 만들기]`

### 1) Summary 4개
| 라벨 | 값 | 단위 | 색 |
|---|---|---|---|
| 진행중인 반 | 24 | 개 | primary |
| 모집중인 반 | 3 | 개 | gold |
| 평균 정원율 | 82 | % | blue |
| 이번 주 수업 | 142 | 시간 | purple |

### 2) 반 카드 (3컬럼 × 2행)
- 각 카드 `<Card padding={20}>` + `display: flex; flex-direction: column; gap: 14`
- 상단:
  - 좌: Pill `${grade} · ${subject}`
  - 우: Pill `● ${status}` (진행중 primary / 모집중 amber)
  - 큰 제목 17px 800 (반 이름)
- 중단 (12px textDim):
  - 강사 라인: 강사명 + 우측 `room` (11px mono)
  - 시간 라인: `${days} · ${time}` (11px mono)
- 정원 진행바:
  - 라벨: `정원 현황` + `12 / 14명` (700 mono)
  - 6px 트랙 (bgSoft 배경)
  - 채움 색:
    - ≥90% → danger (정원 임박)
    - ≥70% → 클래스 색
    - <70% → gold
- 푸터: `border-top 1px line + padding-top 12`
  - 좌: `/class/{name}` (11px mono textFaint)
  - 우: `관리 →` (12px 700)

### 시드 6개 반 (`screens-a.jsx` 참조)
- 중2 수학 심화 A, 중3 수학 심화 C, 고1 영어 정규 B, 고2 국어 정규, 주말 보강반, 예비 중1 수학

---

## 5. 학생목록 — `/students`

### 목적
재원생 248명 전체를 검색/필터하고, AI 케어 상태도 함께 확인.

### Topbar
- actions: `[GhostButton 엑셀] [PrimaryButton 새 학생]`

### 1) Stats 5개
| 라벨 | 값 | 단위 | 색 | 헬퍼 |
|---|---|---|---|---|
| 재원생 | 248 | 명 | primary | +14 신규 |
| 예비 | 12 | 명 | gold | 예비 중1 |
| 퇴원 | 2 | 명 | textDim | 이번 달 |
| 평균 출석 | 94.2 | % | blue | +1.8pt |
| 평균 재원 | 14 | 개월 | purple | 안정 |

### 2) 탭 (border-bottom 1px line, gap 4)
- `[전체 248] [재원 248] [예비 12] [퇴원 24] [결석 위험 9]`
- 활성: `border-bottom: 2px solid primary`, color primary, weight 700

### 3) 학생 테이블 (`Card padding={0}`)
- 헤더 grid: `[학생 1.5fr] [학년 80px] [반 1.3fr] [등록 100px] [학부모 연락처 1.8fr] [수납 100px] [AI 케어 100px] [60px]`
- 각 행:
  - 학생명: 13px 600
  - 학년: 12px textDim
  - 반: 12px
  - 등록 (2024.03): 11px mono textDim
  - 학부모: 12px textDim (`강아빠 · 010-2345-1234`)
  - 수납 Pill: paid (primary 완납) / due (amber 청구 대기) / overdue (danger 미납)
  - AI 케어 Pill: 활발 / 집중 / 주의 / 안정 / 신규
  - 관리: 우측 정렬 primary 600

### 4) Pagination 푸터
- 좌측: `1 — 8 / 248명`
- 우측: `[1][2][3]···[31]` 페이지 칩

### 시드 학생 8명 (`screens-b.jsx` 참조)

---

## 6. 등록상담 (AI) — `/enrollment`

### 목적
신규 등록 상담을 진행하고, AI(Claude)가 학습 스타일을 자동 정리.

### Topbar
- actions: `<PrimaryButton icon="sparkle">새 상담 시작</PrimaryButton>`

### 1) AI 배너 (큰 배너 카드)
- 그라데이션 배경: `linear-gradient(135deg, primary 0%, #2a7a52 100%)`
- 흰 글자, padding `20px 24px`, border-radius 16, shadow `0 14px 32px primary28`
- 우상단 280×280 동심원 SVG 장식 (5개 원, opacity 0.18)
- 좌측 52×52 sparkle 아이콘 박스 (`rgba(255,255,255,0.18)`)
- 텍스트:
  - 키커: `POWERED BY CLAUDE` (11px mono `#e9c876`)
  - 제목: `AI가 등록상담을 듣고, 학습 스타일을 정리합니다.` (17px 800)
  - 본문: `녹음만 업로드하면 학습 스타일 · 관심사 · 우려사항 · 반 추천을 자동으로 요약해드려요.` (13px 78% white)
- 우측 사용량 칩: `[● 이번달 87회 사용]` (8px 14px / 999 radius / rgba(255,255,255,0.12))

### 2) 세션 리스트 (1.6fr) + AI 분석 패널 (1fr)

#### 세션 리스트 카드
- 헤더: 제목 `최근 상담 세션` + 우측 `이번 주 7건`
- 4개 세션 행 (시드: `screens-b.jsx`)
- 각 행: 학부모명 + grade Pill + 추천 텍스트 + 메타(날짜·시간·상담자) + 상태 Pill + `보기 →`
- 상태 종류:
  - `ai-done` (primary · AI 분석 완료)
  - `ai-pending` (amber · AI 분석 대기)
  - `enrolled` (gold · 등록 완료)

#### AI 분석 패널
- 상단: 윤소율 학부모 + grade 메타 + 우측 "AI 완료" pill
- 메타 박스 (bgSoft, mono 11px):
  ```
  // powered by Claude · 2026.05.27 14:55
  // confidence 0.92 · 학습스타일 · 관심사 · 우려 · 반추천
  ```
- 4개 섹션 (12px textDim):
  - `학습 스타일`: 시각적 학습 선호. 반복보다 이해 중심. 또래와의 협력 학습 효과적.
  - `관심사`: 수학 약함 · 영어 강함 · 책 읽기 좋아함
  - `우려 사항`: 새 환경 적응에 2-3주 필요. 강사와 친밀감 형성이 중요.
  - `AI 제안`: **gold 박스** — `수학 심화 A반 + 영어 정규 C반`
- 푸터 버튼 (outline primary): `[↓ 학부모에게 인쇄해서 전달]`

---

## 7. 학생상담 — `/consultations`

### 목적
재원생 케어 상담의 진행 상태를 칸반으로 추적.

### Topbar
- actions: `[GhostButton AI 케어 진단] [PrimaryButton 새 상담 기록]`

### 1) Stats 4개
| 라벨 | 값 | 단위 | 색 | 헬퍼 |
|---|---|---|---|---|
| 진행중 | 11 | 건 | primary | +3 신규 |
| 긴급 | 3 | 건 | danger | 24시간 이내 |
| 예약 | 8 | 건 | blue | 이번 주 |
| 완료 | 42 | 건 | textDim | 이번 달 |

### 2) 칸반 3컬럼
| 컬럼 | 색 | 카운트 | 시드 |
|---|---|---|---|
| 예약 / 대기 | gold | 4 | 윤소율, 한지우, 신아린 |
| 진행 중 | primary | 5 | 이도현 (AI), 정수아 (긴급), 강민서 |
| 완료 (이번 주) | textDim | 6 | 박서진, 최예준, 김도윤 |

각 컬럼:
- 헤더: 8×8 컬러 dot + 제목 13px 700 + 우측 Pill (카운트)
- 카드:
  - padding 12, radius 10, background bgSoft
  - 긴급(`urgent`)이면 dangerSoft 배경 + 1px danger40 보더 + 우측 상단 "긴급" 솔리드 pill
  - `hot` (AI 분석)이면 우측 상단 "AI" primary pill
  - 상단: 학생명 13px 700
  - 본문: 12px textDim
  - 푸터: 10px mono textFaint (`when`)

---

## 8. 퇴원관리 — `/withdrawal`

### 목적
퇴원 추세 추적, AI가 회복 가능 학생 자동 식별.

### Topbar
- actions: `<GhostButton icon="arrowDown">월별 리포트</GhostButton>`

### 1) Stats 4개
| 라벨 | 값 | 단위 | 색 | 헬퍼 |
|---|---|---|---|---|
| 이번 달 퇴원 | 2 | 명 | text | 전월 대비 -3 |
| 올해 누적 | 24 | 명 | textDim | 연 9.7% |
| 평균 재원 | 14 | 개월 | primary | 안정 |
| 회복 가능 | 7 | 명 | amber | 리텐션 캠페인 진행 |

### 2) 최근 퇴원 리스트 (1.4fr)
- 헤더: 제목 `최근 퇴원 (4건)` + 부제 `회복 가능 학생은 자동으로 리텐션 후보에 추가됩니다.`
- 행 grid: `1.6fr [학년 70px] 1.6fr [날짜 100px] [기간 90px] [회복 60px]`
- 각 행: 이름 + 학년 + 사유 + 날짜 + 기간 + 회복 pill (또는 `—`)

### 3) 사유 분석 (1fr)
- 카드 padding 20
- 제목 + 부제 `2026 누적 24건`
- 5개 사유 진행바:
  - 입시학원 이전 8건 33% primary
  - 경제 사정 5건 21% gold
  - 이사 4건 17% blue
  - 성적 정체 4건 17% amber
  - 기타 3건 12% textDim
- AI 인사이트 박스 (하단):
  - amberSoft 배경 + amber40 보더, padding 14, radius 10
  - 24×24 sparkle 박스 (amber bg / 흰 글자)
  - 본문: `"성적 정체" 사유 4건은 모두 도입 12개월 차에 발생. 1년차 학습 만족도 점검 추천.`

---

## 9. 직원관리 — `/staff`

### 목적
강사·상담실장·행정 직원 정보, 담당 반/학생/급여.

### Topbar
- actions: `[GhostButton 급여 명세서] [PrimaryButton 직원 추가]`

### 1) Stats 5개
- 전체 8명 (강사 5 · 행정 2 · 상담 1)
- 근무 중 7명 (오늘 출근 6)
- 휴가 1명 (정유진 · ~5/29)
- 총 급여 2,140만원 (이번 달)
- 평균 재직 3.2년

### 2) 직원 카드 그리드 (3컬럼)
- 시드 6명: 박지훈(부원장)·이연우·최보라·김상담·박지원(신입)·정유진(행정·휴가중)
- 각 카드:
  - 상단: 이름 15px 800 + 상태 pill (근무 중 primary · 휴가 amber) + 역할 12px textDim + 재직 11px mono textFaint
  - 강사이면 (classes > 0): 3컬럼 미니 그리드 (담당 반 · 학생 · 이번달 급여)
    - 각 컬럼: 라벨(10px mono uppercase) + 큰 숫자(18px 800 mono tabular)
    - 배경: bgSoft, padding 12, radius 10
    - 이번달 급여만 직원 색깔
  - 비강사: bgSoft 박스 한 줄 (`비강사 · 이번달 급여 220만원`)
  - 푸터: `/staff/{name}` mono + 관리 →

---

## 10. 수납관리 — `/billing`

### 목적
청구·납부·미납을 한 화면에서 추적, 자동 청구서.

### Topbar
- actions: `[GhostButton 청구서 일괄 발행] [PrimaryButton 수동 청구]`

### 1) Summary 4개
| 라벨 | 값 | 단위 | 색 | 부제 |
|---|---|---|---|---|
| 이번달 청구 | 8,754 | 만원 | text | 248건 |
| 수납 완료 | 7,612 | 만원 | primary | 216건 · 87.1% |
| 청구 대기 | 880 | 만원 | amber | 23건 |
| 미납 | 262 | 만원 | danger | 9건 · 평균 4일 |

### 2) 진행률 스트립
- 카드 padding 16
- 라벨: 좌 `2026년 6월 수납 진행률` 우 `87.1%` (700 tabular)
- 10px 트랙, bgSoft 배경, 세 색으로 분할:
  - 87.1% primary
  - 9.7% amber
  - 3.2% danger
- 하단 범례: 8×8 색 정사각형 + 라벨 (`완납 216건`, `대기 23건`, `미납 9건`)

### 3) 탭 + 테이블
- 탭 4개: 전체 248 · **미납 9 (활성)** · 완납 216 · 대기 23
  - 활성: dangerSoft 배경, danger 색, 700
- 우측: `2026.06 기준` (11px mono textFaint)
- 헤더 grid: `[학생 1.3fr] [반 1.4fr] [기간 90px] [금액 110px] [납기 110px] [상태 110px] [액션 80px]`
- 각 행:
  - 학생 13 600
  - 반 12 textDim
  - 기간 (2026.06) 11px mono textDim
  - 금액 (352,000원) 우측 정렬, mono tabular 600
  - 납기 (2026.06.05) mono 11; 미납이면 danger + 700 + 보조 9px (`7일 경과`)
  - 상태 Pill (paid/due/overdue)
  - 액션: 영수증 / 청구 / 독촉 (상태별)

### 시드 8건 — `screens-c.jsx` 참조

---

## 11. 회의록 (AI) — `/meetings`

### 목적
회의 녹음 → AI 자동 요약 → 액션 아이템 추적. Realtime watcher.

### Topbar
- actions: `[GhostButton AI 재요약] [PrimaryButton 새 회의 시작]`

### 1) 회의 리스트 (1.5fr)
- 상단: 제목 + `이번 달 12건` + 우측 `[● 1건 녹음 중]` danger pill
- 4개 회의 카드:
  - 일반: surface 배경, line 보더
  - **녹음 중 (live)**: dangerSoft 배경, 1.5px danger 보더, 우상단 [● LIVE] solid danger pill
- 각 카드 좌측: 44×44 아이콘 박스 (live면 danger + pulse · 일반이면 primarySoft + rings)
- 제목 15 700 + 메타(날짜·시간·참석 N명) + 상태 Pill (`● AI 요약 완료`) + 액션 아이템 카운트
- 우측: `보기 →` (live는 없음)

### 시드 4건: 주간 강사 회의(완료), 신입생 적응 점검(완료), 6월 시험 일정 조율(녹음중), 5월 마감 회의(완료)

### 2) AI 요약 패널 (1fr)
- 헤더: sparkle 아이콘 박스 + 회의 제목 + 메타 + "AI 완료" pill
- 메타 박스 (bgSoft, mono):
  ```
  // confidence 0.94 · 5 speakers · 32m 14s
  // summary + action items + decisions
  ```
- 핵심 결정사항 (primary 키커):
  - 6월 시험 일정 6/14 토 확정
  - 고1 영어 정규 B반 → C반 분반 검토
  - 신입 강사 박지원 → 중1 수학 보조 배정
- 액션 아이템 4건 (gold 키커):
  - 각 행: 16×16 체크박스 + 담당자 11 600 + 작업 12 + 마감 (10 mono `~5/30`)
  - 완료된 항목은 line-through + opacity 0.6

---

## 12. 도움말 — `/help`

### 목적
가이드·FAQ·단축키·문의를 한 곳에서.

### Topbar
- actions: `<GhostButton icon="bell">새 기능 알림 받기</GhostButton>`

### 1) Search Hero
- `<Card padding={28}>` + linear-gradient bg (surface → surfaceHi)
- 우상단 220×220 트리링 SVG 장식
- H2: `무엇을 도와드릴까요?` (22px 800)
- 본문 13px textDim
- 검색 박스: surface + lineStrong 보더, padding 12 16, radius 12, shadow card-hover
  - 좌 search 아이콘 + placeholder 14 textDim + 우 `⌘K` pill

### 2) 좌측 (1.5fr) — 가이드 카테고리 + FAQ

#### 가이드 카테고리 (2컬럼 그리드)
6개 카테고리:
| 제목 | 아이콘 | 색 | 아이템 수 | 부제 |
|---|---|---|---|---|
| 시작하기 | sprout | primary | 8 | 5분 안에 EYWA를 설정하는 법 |
| 학생 등록 | seed | blue | 12 | 신규/예비 학생 추가, 일괄 가져오기 |
| 시간표 짜기 | leaf | purple | 6 | 드래그로 반 이동, 충돌 자동 감지 |
| 출결과 알림 | pulse | amber | 9 | 카톡 알림 설정, 일괄 체크 |
| 수납 관리 | pollen | gold | 14 | 청구서 발행, 미납 독촉, 영수증 |
| AI 분석 활용 | sparkle | primary | 7 | 등록상담 · 케어 · 회의록 요약 |

각 카드:
- padding 16, 좌측 40×40 컬러 아이콘 박스
- 제목 14 700 + 카운트 작은 칩 + 부제 12
- 우측 끝 화살표 (12px textFaint)

#### FAQ
- 카드 padding 0
- 3개 질문 (Q1. AI 상담분석은? / Q2. 데이터는 안전? / Q3. 마이그레이션)
- 각 항목 padding 16 18, line-bottom

### 3) 우측 (1fr) — 단축키 + 문의

#### 키보드 단축키 카드
- branch 아이콘 + 제목 `키보드 단축키`
- 6개 항목 (라벨 ↔ 키 칩 우측 정렬, 키 칩은 mono 11 + bgSoft 배경 + line 보더)
- `⌘ K` 전역 검색 / `⌘ N` 새 학생 / `⌘ /` 단축키 도움말 / `G + D` 대시보드 / `G + S` 학생목록 / `G + B` 수납

#### 1:1 문의 카드 (그라데이션)
- background `linear-gradient(135deg, primary 0%, #2a7a52 100%)`
- 키커 `1:1 문의` (mono gold #e9c876) + 큰 제목 `해결되지 않았나요?` (16 800)
- 본문 12 78% white
- 흰 버튼 `채팅 문의 시작 →`
- 푸터: `1670-0000 · 평일 10:00 — 18:00` (mono 11 60% white, 중앙 정렬)

---

## 공통: 데이터 / 시드

`design-files/eywa-shared.jsx`의 `EYWA_DATA`:

```ts
const EYWA_DATA = {
  kpis: [ ... ],          // 4개 (대시보드용)
  events: [ ... ],        // 6개 일정
  announcements: [ ... ], // 3개 공지
  trend: { ... },          // 분기 추이 (12개월)
};
```

기타 시드는 각 screens-*.jsx 파일의 상단에 명시되어 있습니다.
