# EYWA — 디자인 핸드오프 패키지

> 학원관리 SaaS · 랜딩 페이지 + 12개 내부 화면
> Daylight (Toss-style) 에디토리얼 방향 · 한국어 UI

---

## 1. 개요 (Overview)

EYWA는 인재원 학원관리 시스템의 v2.0 경량 재작성판입니다. 기존 ijw-calander의 43개 탭을 **12개의 핵심 메뉴**(5개 카테고리)로 줄여 다시 짠 SaaS입니다.

이 패키지는 다음 두 가지를 픽셀 단위로 구현 가능하게 정리한 문서입니다:

1. **랜딩 페이지** — `Hero · Flow · LogoWall · Manifesto · Testimonials · Pricing · CTA · Footer`
2. **12개 내부 화면** — `대시보드 · 시간표 · 출석부 · 수업목록 · 학생목록 · 등록상담 · 학생상담 · 퇴원관리 · 직원관리 · 수납관리 · 회의록 · 도움말`

---

## 2. 디자인 파일에 대해 (About the Design Files)

`design-files/` 폴더의 HTML/JSX 파일들은 **디자인 레퍼런스**입니다 — 의도된 시각과 동작을 보여주는 HTML 프로토타입이지, 그대로 프로덕션에 복사해 쓸 코드가 아닙니다.

여러분의 작업은 이 HTML 디자인을 **실제 코드베이스(Next.js + Supabase + Tailwind)에 맞게 다시 구현**하는 것입니다. 코드베이스의 기존 패턴·컴포넌트 라이브러리·스타일 시스템을 따라 만들어주세요.

### 권장 환경 (참조 레포: `github.com/BIGSHOL/eywa`)

| 영역 | 권장 |
|---|---|
| 프레임워크 | **Next.js 15 App Router** (참조 레포가 이걸 씁니다) |
| 스타일 | **Tailwind CSS** (디자인 토큰은 `tailwind.config.ts`에 매핑) |
| 컴포넌트 | shadcn/ui 또는 자체 atoms |
| 폰트 | **Pretendard Variable** + JetBrains Mono (모노스페이스) |
| 아이콘 | 자체 stroke SVG 세트 ( `eywa-shared.jsx`에 정의 ) 또는 lucide-react |
| 데이터 | Supabase Postgres + RLS, Realtime |
| 인증 | Supabase Auth |
| AI | Anthropic Claude API (등록상담 · 학생상담 · 회의록 요약) |

> 코드베이스에 환경이 아직 없다면 위 스택으로 시작하면 됩니다.

---

## 3. 충실도 (Fidelity)

**Hi-fi (픽셀 퍼펙트)**입니다. 색상·타이포그래피·간격·모서리·그림자 모두 최종 값입니다. 코드베이스의 기존 컴포넌트 라이브러리를 사용하되 **시각적 결과는 디자인 파일과 픽셀 단위로 일치해야 합니다.**

- 모든 색은 hex 값으로 명시 (`docs/DESIGN_TOKENS.md`)
- 폰트는 Pretendard Variable + JetBrains Mono
- 간격은 4px 그리드 (이외 값은 8px 그리드)
- 폭은 1440px 기준 (반응형은 추후, 일단 데스크탑)

---

## 4. 문서 구성

| 파일 | 내용 |
|---|---|
| `README.md` | (이 파일) 개요 + 시작 가이드 |
| `docs/DESIGN_TOKENS.md` | 컬러 팔레트 · 타이포 · 간격 · 모서리 · 그림자 · 모션 |
| `docs/COMPONENTS.md` | AppShell · Sidebar · Topbar · Atoms (Pill, Button, Card, Initial, Icons) |
| `docs/SCREENS.md` | 12개 내부 화면 상세 (레이아웃 + 컴포넌트 + 데이터 + 동작) |
| `docs/LANDING.md` | 랜딩 페이지 8개 섹션 상세 |
| `docs/MENUS.md` | 12개 메뉴 + 5개 카테고리 매핑 + 라우트 |
| `docs/DATA.md` | 시드 데이터 (학생 · 수업 · 일정 · 직원 등) |
| `design-files/*.html` | 브라우저에서 열어 보면 실제 동작/렌더링 확인 가능 |
| `design-files/*.jsx` | 픽셀 단위 코드 (정확한 값 추출용) |

---

## 5. 시작하기 (Getting Started)

### 1) HTML 디자인 직접 열어보기
```bash
# 패키지 압축 해제 후
cd design_handoff_eywa/design-files/
# 브라우저에서 직접 엽니다
open "EYWA Screens.html"     # 12개 내부 화면 (디자인 캔버스)
open "EYWA Landing.html"     # 랜딩 페이지
```

### 2) 구현 시작 순서
1. **DESIGN_TOKENS** 먼저 `tailwind.config.ts`에 매핑
2. **COMPONENTS** — AppShell + Sidebar + Topbar + atoms 먼저
3. **SCREENS** — 대시보드부터 시작 (다른 화면이 패턴을 참조)
4. **랜딩** — Hero · LogoWall · Pricing 순으로 (CTA는 마지막)

### 3) 우선순위 (Phase 추천)

| Phase | 범위 | 비고 |
|---|---|---|
| P0 | 디자인 토큰 + AppShell + Sidebar + Topbar | 모든 화면의 기반 |
| P1 | **대시보드 + 학생목록 + 시간표 + 출석부** | 매일 쓰는 4개 |
| P2 | **수납관리 + 등록상담(AI)** | 매출/신규 연동 |
| P3 | 학생상담 · 회의록 · 직원관리 | |
| P4 | 퇴원관리 · 수업목록 · 도움말 | |
| P5 | 랜딩 페이지 | 백오피스 안정화 후 |

---

## 6. 핵심 디자인 원칙

1. **자연 · 유기적이되 그라운디드** — 포레스트 그린(#1a5f3c) 중심, 골드(#b8893a) 액센트. 네온/사이안/판타지 색감 절대 금지.
2. **에디토리얼 톤** — 큰 헤드라인 + 절제된 카피. 단, 이탤릭 세리프 폰트는 사용하지 않습니다 (Pretendard만).
3. **동그란 프로필 사진 사용하지 않음** — 모든 사람 표시는 `Initial` (8px radius 정사각형, 컬러 배경 + 글자 색) 사용
4. **베타 출시 톤** — 가격은 "베타 무료" + "정식 출시 후 변동 예정" 명시
5. **AI는 3곳에 적용** — 등록상담 · 학생상담(케어) · 회의록 요약 (Anthropic Claude API)
6. **카피 톤** — 일반적인 학원 SaaS 톤. 추상적/시적 표현 피함 ("학원 운영을 한 곳에서", "원장님이 가장 먼저 켜는 학원관리 프로그램")

---

## 7. 12개 메뉴 (요약)

| # | 카테고리 | 메뉴 | 라우트 | AI |
|---|---|---|---|---|
| 1 | **홈** | 대시보드 | `/` | — |
| 2 | **수업** | 시간표 | `/timetable` | — |
| 3 | | 출석부 | `/attendance` | — |
| 4 | | 수업목록 | `/classes` | — |
| 5 | **학생** | 학생목록 | `/students` | 케어 분석 |
| 6 | | 등록상담 | `/enrollment` | ★ 분석/요약 |
| 7 | | 학생상담 | `/consultations` | — |
| 8 | | 퇴원관리 | `/withdrawal` | 패턴 인사이트 |
| 9 | **운영** | 직원관리 | `/staff` | — |
| 10 | | 수납관리 | `/billing` | — |
| 11 | | 회의록 | `/meetings` | ★ 요약/액션아이템 |
| 12 | **지원** | 도움말 | `/help` | — |

---

## 8. 사용자/조직 컨텍스트 (페르소나)

- **회사명**: EYWA · 인재원
- **고객사 예시 (시드 데이터)**: 인재원 · 강남
- **사용자 페르소나**: 김수진 원장 (28년차 · 재원생 248명)
- **고객 학원 시드**: 청솔학원, MS어학원, 명문국어, 수림수학, 하이클래스, 에듀온, 베스트영어 등 47개

---

## 9. 다음 단계

1. 디자인 파일을 브라우저에서 직접 열어 픽셀 확인
2. `docs/DESIGN_TOKENS.md` → Tailwind config 작성
3. `docs/COMPONENTS.md` → 공통 컴포넌트 구현
4. `docs/SCREENS.md` → 화면 하나씩 구현

질문이 생기면 디자인 파일의 해당 JSX 코드를 직접 참조하세요 — 정확한 px 값이 거기 있습니다.
