import { Suspense, type ReactNode } from "react";
import { MenuPageTitle } from "@/features/owner/menu-page-title";
import { PageMaximizeButton } from "@/components/page-maximize/page-maximize-button";

/**
 * PageHeader — Editorial 문법 ①의 단일 소스. **한 줄**: `eyebrow - 제목 - 설명 ………… [actions] [화면 최대화]`.
 * 🔴 원장 2026-10-01 *"구조도 3행이 아니라 1행으로 — 수업운영 - 시간표 - 주간 시간표"* — 옛 3행(eyebrow / 24px 제목 /
 *    설명)을 한 줄로 눕혔다. 구분자는 원장이 적은 대로 ` - `. 제목(24px Bold)이 가장 먼저 읽히고 앞뒤(16px Medium)는 작게 —
 *    글자색은 한 값(#121212)이라 "흐리게"는 크기·굵기로만 낸다(연한 회색 글자를 새로 만들지 않는다, 디자인 v5).
 *    설명이 길면 제목 옆 남는 폭에서 접힌다(줄 전체를 아래로 내리지 않는다).
 * 오른쪽 끝 = 화면 동작(`actions`) + **'화면 최대화'**([`PageMaximizeButton`](./page-maximize/page-maximize-button.tsx) —
 * 관리자 풀셸·창 모드 꺼짐·데스크톱에서만 스스로 보인다). 최대화 중에는 제목 묶음이 숨고(동작·스탯이 없으면 헤더 통째로),
 * 동작·스탯은 남는다(`data-page-header`, globals.css).
 * stats에는 BigStat 그리드(문법 ②)를 끼운다.
 *
 * ⚠️ 임베드(플로팅 창, ?embed=1) 컴팩트 모드(2026-07-19 원장 지적 — "창 안 헤더가 본문을 잠식 +
 * 제목 3중 노출(상단 바·창 타이틀바·인페이지)"): 창 안에선 **창 타이틀바가 제목**이므로
 * eyebrow·제목·구분자를 접고 embedLabel ?? description(?? title)을 한 줄로 — actions와 같은 행.
 *
 * ⚠️ 판정은 요청 헤더(x-embed)가 아니라 **임베드 셸 <main>의 `.embed-main` 마커 + CSS 변형**이다
 * (적대 리뷰 major): x-embed는 요청 단위라 창 안 내비(주 이동·월 이동 등, 대다수 href 빌더가
 * embed=1 미보존)마다 풀 헤더로 플립했다. layout의 임베드 <main>은 soft nav에서 재렌더되지 않아
 * 마커가 유지되고, 단일 마크업이라 actions/stats 슬롯 이중 마운트(#67류)도 없다. 서버 렌더 시점에
 * 클래스가 이미 확정돼 하이드레이션 플래시도 없음. 최상위 프레임(모바일 라우트·직접 방문)은
 * 마커가 없어 Editorial 풀 헤더 그대로다.
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  embedLabel,
  actions,
  stats,
}: {
  /** 앞머리 소라벨(문법 ①) — 예: "학생 관리". 한글 전제, uppercase 없음. 한 줄 헤더에서 제목 앞에 선다. */
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  /**
   * 임베드 컴팩트 행의 라벨 명시 지정(기본 description ?? title). title이 메뉴명이 아니라
   * **콘텐츠**(수납의 "2026년 7월" 등)라 컴팩트 행에서 사라지면 안 되거나, description이
   * 길어 창 안에서 여러 줄로 감길 때 짧은 대체 문구로 쓴다.
   */
  embedLabel?: ReactNode;
  actions?: ReactNode;
  /** 헤더 아래 붙는 BigStat 행 슬롯(문법 ②). */
  stats?: ReactNode;
}) {
  // 컴팩트 행 라벨이 desc/embedLabel로 이미 있으면 임베드에선 title을 숨긴다(타이틀바와 중복).
  // 없으면 title 자체를 16px로 강등해 라벨로 쓴다(빈 행 방지 — 미래 소비처 안전망).
  const hasCompactLabel = Boolean(embedLabel ?? description);
  return (
    // 🔴 **상단 헤더와 본문 사이 가벼운 구분선 하나**(원장 2026-09-01: *"상단 헤더랑 본문 사이에
    //    '구분선' 하나만 가볍게 넣어줘"* + *"이 구분선 스타일은 웹앱 전체에 통일"*).
    //    ⚠️ 종전 규약은 "구분선 대신 여백 리듬"이었다 — 원장이 명시로 뒤집은 것이라, 화면마다 자기
    //    선을 새로 긋지 말고 **여기 한 줄**만 쓴다(굵기·색이 갈리면 통일이 아니다).
    //    가장 옅은 선(`--line-faint`)이다: 존재를 알리되 칸 테두리·표 선보다 앞서지 않는다.
    // `data-page-header` = 화면 최대화 표식(globals.css). 동작·스탯이 없으면 `bare` — 헤더 통째로 숨는다.
    //   있으면 `tools` — 제목 묶음(`data-page-header-title`)만 숨고 동작(날짜 이동·새 항목 등)·스탯은 남는다
    //   (최대화가 화면 조작까지 가져가면 안 된다 — 자리 출석부는 날짜 이동이 여기 있다, 적대 리뷰).
    <header
      data-page-header={actions || stats ? "tools" : "bare"}
      className="border-line-faint flex flex-col gap-4 border-b pb-3 compact-chrome:gap-3 compact-chrome:pb-2"
    >
      <div data-page-header-row="" className="flex flex-col gap-2 px-1 sm:flex-row sm:items-center sm:justify-between compact-chrome:flex-row compact-chrome:flex-wrap compact-chrome:items-baseline compact-chrome:gap-x-3 compact-chrome:gap-y-1">
        {/* 구분자는 **뒤 항목과 한 덩어리**다 — 줄이 꺾여도 ` - `가 앞 줄 끝에 홀로 남지 않는다.
            `flex-1`·설명 최소 폭·Medium은 데스크톱 한 줄에만(컴팩트 1행은 종전 모양 그대로 — 라벨이 버튼을 밀어내지 않게). */}
        <div
          data-page-header-title=""
          className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2 gap-y-1 compact-chrome:flex-initial compact-chrome:gap-y-0"
        >
          {eyebrow ? (
            <p className="text-foreground text-sm font-medium whitespace-nowrap compact-chrome:hidden">{eyebrow}</p>
          ) : null}
          <div
            className={`flex items-baseline gap-x-2 ${hasCompactLabel ? "compact-chrome:hidden" : ""}`}
          >
            {eyebrow ? <Separator /> : null}
            <h2
              className={`text-foreground text-xl font-bold tracking-tight ${
                hasCompactLabel
                  ? ""
                  : "compact-chrome:text-text-dim compact-chrome:text-sm compact-chrome:font-medium compact-chrome:tracking-normal"
              }`}
            >
              <Suspense fallback={title}><MenuPageTitle title={title} /></Suspense>
            </h2>
          </div>
          {description ? (
            <div
              className={`flex min-w-[min(100%,20rem)] flex-1 items-baseline gap-x-2 compact-chrome:min-w-0 compact-chrome:flex-initial ${
                embedLabel ? "compact-chrome:hidden" : ""
              }`}
            >
              <Separator />
              <div className="text-text-dim min-w-0 text-sm font-medium compact-chrome:font-normal">{description}</div>
            </div>
          ) : null}
          {embedLabel ? (
            <div className="text-text-dim hidden text-sm compact-chrome:block">{embedLabel}</div>
          ) : null}
        </div>
        {/* 임베드에선 shrink/wrap 허용 — actions로 들어온 툴바(문서 검색 등)의 내부 flex-wrap이
            좁은 창에서 실제로 발동하게(shrink-0 고정이면 max-content 폭이 창을 뚫음, 적대 리뷰).
            `empty:hidden` — 동작도 없고 최대화 버튼도 안 서는 셸(창·미니셸·슈퍼관리자)에선 빈 칸을 남기지 않는다. */}
        <div className="flex shrink-0 items-center gap-2 empty:hidden compact-chrome:min-w-0 compact-chrome:shrink compact-chrome:flex-wrap">
          {actions}
          <PageMaximizeButton />
        </div>
      </div>
      {stats ?? null}
    </header>
  );
}

/** 한 줄 헤더의 구분자 ` - ` — 앞뒤 간격은 묶음의 `gap-x-2`. 창·모바일(컴팩트)에선 라벨이 하나뿐이라 숨는다. 읽지 않는다. */
function Separator() {
  return (
    <span aria-hidden className="text-foreground text-sm font-medium compact-chrome:hidden">
      -
    </span>
  );
}

/**
 * PageHeader 자리 스켈레톤(`loading.tsx`) — 실 헤더와 **같은 한 줄 높이·같은 구분선·같은 표식**.
 * 🔴 표식(`data-page-header`)이 빠지면 화면 최대화 중에 스켈레톤만 헤더 높이로 섰다가 본문이 도착하는 순간 통째로 위로 튄다.
 *    동작 자리를 넘기면 실 헤더처럼 `tools`(최대화 때 제목 막대만 숨고 동작 막대는 남는다).
 * - `hideCompact` — 실 화면이 헤더를 `compact-chrome:hidden` 래퍼로 감싸 창·모바일에서 아예 없앨 때(시간표·강사 시트 주간·월간).
 * - `withStats` — 실 헤더가 `stats`(KPI)를 남기는 화면이면 켠다(최대화 때 실 헤더와 같은 `tools`로 판정되게).
 * - `actions` — 실 헤더 오른쪽 동작 자리(높이를 그 컨트롤과 같은 변수로 — 스켈레톤 캐논).
 */
export function PageHeaderSkeleton({ hideCompact = false, actions, withStats = false }: { hideCompact?: boolean; actions?: ReactNode; withStats?: boolean }) {
  return (
    <header
      data-page-header={actions || withStats ? "tools" : "bare"}
      aria-hidden
      className={`border-line-faint shrink-0 border-b pb-3 compact-chrome:pb-2 ${hideCompact ? "compact-chrome:hidden" : ""}`}
    >
      <div data-page-header-row="" className="flex items-center justify-between gap-3 px-1">
        {/* 줄 높이 = 실 제목 줄(text-xl 한 줄 = 1lh). 컴팩트(창·모바일)에선 제목이 접히고 16px 라벨 한 줄(h-6)만 남는다. */}
        <div data-page-header-title="" className="flex min-w-0 items-center gap-2 text-xl">
          <div className="bg-bg-soft h-4 w-16 shrink-0 animate-pulse rounded compact-chrome:hidden" />
          <div className="bg-bg-soft h-[1lh] w-40 shrink-0 animate-pulse rounded compact-chrome:hidden" />
          <div className="flex h-6 min-w-0 items-center">
            <div className="bg-bg-soft h-4 w-56 max-w-full animate-pulse rounded" />
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </header>
  );
}
