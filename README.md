# aywa — 인재원 학원관리 경량 버전

[D:\ijw-calander](D:\ijw-calander)의 어설픈 구조와 부풀어 오른 메뉴(43개 탭)를 정리하여 다시 짠 학원관리 SaaS입니다. **운영 중**이다(테넌트 `injaewon` = 실데이터 · 배포 = main). 작업 규칙·결정은 [`CLAUDE.md`](CLAUDE.md)가 단일 소스다.

## 스택

- **Next.js 16 (App Router)** + TypeScript + Turbopack
- **Tailwind v4** + **shadcn/ui** (base-nova preset)
- **Supabase**: Postgres + Auth + Realtime + Storage + RLS
- **Drizzle ORM** + drizzle-kit
- **TanStack Query** (client mutations) + **Zustand** (UI state only)
- **Zod** (런타임 가드)
- **Vitest** + **Testing Library** (단위), **Playwright** (E2E)
- **AI**: Anthropic Claude(1순위 — Sonnet 5.5 · 멘트는 Haiku 5.5) / DeepSeek(폴백만) — 단일 진입점 `generateJSON()`(예외: 학원 비서). Solar는 2026-10-19 제거. 상세 = CLAUDE.md 'AI 모델 정책'
- 배포: **Vercel**

## 메뉴

```
운영실 (AI 실행 큐·운영 브리핑) · 수업 운영 [시간표/출결 처리/반·수업/수업 보고] · 학생 [학생/학생 상담/등록 상담/이탈 신호/퇴원] · 경영 [팀/수납·청구/회의/문서함] · 설정
```

- **수납관리**는 창 오른쪽 세로 책갈피로 **수납 · 교재신청 · 지출** 3면 전환(`?tab=`).
- 운영실은 셸의 기본 데스크톱 작업면이며, 나머지 메뉴는 그 위의 크롬리스 플로팅 창(멀티윈도우 워크스페이스)으로 열린다.

진행 상황·셋업·다음 할 일은 [`HANDOFF.md`](HANDOFF.md), 상세 규약·함정은 [`CLAUDE.md`](CLAUDE.md), 구조는 [src/features/README.md](src/features/README.md) 참고.

## 시작하기

```bash
# 1. 환경변수 설정
cp .env.local.example .env.local
# Supabase Project Settings → API/Database에서 값을 채워 넣기

# 2. 의존성 설치 (이미 설치되어 있다면 생략)
pnpm install

# 3. 개발 서버
pnpm dev
```

http://localhost:3100 접속. (포트 3100 고정)

## 주요 스크립트

```bash
pnpm dev              # Next 개발 서버
pnpm build            # 프로덕션 빌드
pnpm typecheck        # tsc --noEmit
pnpm lint             # ESLint
pnpm test             # Vitest 단위 테스트
pnpm test:watch       # Vitest watch
pnpm test:e2e         # Playwright E2E (dev 서버 자동 기동)
pnpm db:generate      # Drizzle 스키마 → SQL 초안(supabase/drizzle-out/ — 필요한 문장만 s2_NNNN 파일로)
pnpm db:alphas        # 새(빈) DB 셋업 — 시즌1 합본 구역 → 시즌2 파일(빈 DB가 아니면 멈춘다 · db:migrate는 안내만)
pnpm db:studio        # Drizzle Studio (테이블 탐색기)
```

## 폴더 구조

```
src/
├─ app/                # Next 라우트 (Phase 1에서 (shell)/(auth)/(print) 그룹 추가)
├─ components/ui/      # shadcn 생성물
├─ features/           # 도메인별 모듈 — 12개 메뉴 = 12개 폴더
├─ hooks/              # 공용 클라이언트 훅
└─ lib/
    ├─ supabase/       # server/client/middleware 클라이언트
    ├─ db/             # Drizzle 클라이언트 + schema
    ├─ ai/             # Claude API 래퍼
    ├─ providers/      # React Query 등 Context Provider
    ├─ permissions.ts  # 역할 × 메뉴 접근 매트릭스
    └─ utils.ts        # shadcn 기본 cn() 헬퍼
supabase/
├─ migrations/         # drizzle-kit 생성 SQL + 손수 다듬은 RLS 정책
├─ tests/              # pgTAP RLS 검증
└─ seed.sql            # 데모 시드
tests/
├─ unit/               # Vitest
└─ e2e/                # Playwright
```

## 현재 상태

12개 메뉴 + ijw 패리티 + Admin/super-admin + 멀티윈도우 워크스페이스 + 수납관리 책갈피(교재/지출)까지 구현 완료.
현재 작업 상태·다음 할 일은 [`HANDOFF.md`](HANDOFF.md), 진행 이력은 [`CLAUDE.md`](CLAUDE.md) "진행 상황" 참고.
(⚠️ 테넌트 `injaewon`은 운영 실데이터다. 데모 시드(`pnpm db:seed`)는 운영 DB를 지울 수 있어 2026-09-19 영구 제거했다.)
