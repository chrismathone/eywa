import { MessagesSquare, CalendarClock, BellRing, AlarmClock, Mic, Sparkles } from "@/components/icons/eywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { consultationPreview } from "@/features/consultations/summary-preview";
import { WindowLink } from "@/components/workspace/window-link";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { MakeeduOriginTag } from "@/components/makeedu-origin-tag";
import { EditingBadge } from "@/features/presence/editing-badge";
import { Pill } from "@/components/atoms/pill";
import { PhotoCard } from "@/components/atoms/photo-card";
import { requireAccess } from "@/lib/auth/require-access";
import {
  followUpUrgency,
  getConsultationCounselorOptions,
  getStudentConsultationCounts,
  getStudentConsultationsPage,
  type StudentConsultationCategory,
  type StudentConsultationRow,
} from "@/features/consultations/server/queries";
import { Pagination } from "@/components/pagination";
import { NewConsultationTrigger } from "./_components/new-consultation-trigger";
import { SearchToggle } from "@/components/search-toggle";
import { AutoPageSize } from "@/components/auto-page-size";
import { clampPageSize, pageSizeCookieName } from "@/components/page-size";
import { cookies } from "next/headers";
import type { CSSProperties } from "react";
import { CATEGORY_META, URGENCY_META } from "./_components/consultation-meta";
import { relativeTimeKo } from "@/lib/relative-time";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";

export const metadata = { title: "원생상담 — eywa" };

type RangeKey = "all" | "7d" | "30d";
type CategoryKey = "all" | StudentConsultationCategory;
type UrgencyKey = "all" | "overdue" | "today" | "soon" | "later" | "done";

/**
 * 필터 축 셋 — 옛 화면은 이 셋을 **알약 칩 16개**로 툴바 두 줄에 펼쳤다. 디자인 지시서 §10(원장 2026-09-03
 * *"남은 결정사항은 지시서 그대로"*): *"필터·정렬은 목록 헤더 라벨을 눌러 호출"* → 축마다 **라벨 하나**
 * (드롭다운, 고른 값이 라벨이 된다)로 접었다. 선택지는 그대로다.
 */
const RANGE_OPTIONS: { value: Exclude<RangeKey, "all">; label: string }[] = [
  { value: "7d", label: "최근 7일" },
  { value: "30d", label: "최근 30일" },
];
const CATEGORY_OPTIONS: { value: Exclude<CategoryKey, "all">; label: string }[] = [
  { value: "academic", label: "학습" },
  { value: "emotional", label: "정서" },
  { value: "career", label: "진로" },
  { value: "social", label: "교우" },
  { value: "general", label: "일반" },
  { value: "other", label: "기타" },
];
const URGENCY_OPTIONS: { value: Exclude<UrgencyKey, "all">; label: string }[] = [
  { value: "overdue", label: "지연" },
  { value: "today", label: "오늘" },
  { value: "soon", label: "3일 내" },
  { value: "later", label: "예정" },
  { value: "done", label: "완료" },
];

/**
 * 한 쪽의 행 수는 **창이 정한다**(원장 2026-09-03 *"창 크기에 따라서 스마트하게 유동성 있게"*): [AutoPageSize](@/components/auto-page-size)가
 * 목록 아래 남는 높이 × 단 수를 재어 `?size=N`으로 다시 청하고 그 값을 기기 쿠키에 남긴다. 서버는 URL → 쿠키 → 이 기본값 순으로
 * 읽고 같은 범위([page-size.ts](@/components/page-size))로 clamp한다(왕복 방지).
 * 기본값 6 = 창을 처음 여는 크기(= 최소 창 760×640, 본문 601px)에서 실측한 행 수(제목 행 36px 포함, 2026-09-04 재실측 — 7이면 4px 넘쳤다) — 쿠키가 없는 첫 방문에도 다시 청하지 않게.
 */
const DEFAULT_PAGE_SIZE = 6;
const PAGE_SIZE_KEY = "consultations";
/** 행 높이(h-11 44px) + 헤어라인 1px — AutoPageSize가 이 값으로 행 수를 센다. 행 높이를 바꾸면 여기도. */
const ROW_PX = 45;
/**
 * 오른쪽 폭 고정 열(카테고리 | 후속 | 녹음·AI | 시각)의 폭(rem) — 16px 라벨 실측: 카테고리 알약 ≤56 · 후속 알약 ≤64 ·
 * "녹음 AI" 85.4 · "2026. 12. 31." 98.2. 🔴 바깥 행 그리드의 4번째 트랙은 **이 합 + 안쪽 간격**으로 여기서 함께 도출한다 —
 * 둘을 따로 적었다가 안쪽이 12px 넘쳤다(적대적 리뷰 2026-09-03). 바꿀 땐 여기 하나만.
 */
const RIGHT_COLS_REM = [3.5, 4, 5.5, 6.5] as const;
const RIGHT_GAP_REM = 0.25; // = gap-1
const RIGHT_W_REM = RIGHT_COLS_REM.reduce<number>((a, b) => a + b, 0) + RIGHT_GAP_REM * (RIGHT_COLS_REM.length - 1);
/** 행 그리드: 이름(9~13rem) | 과목·상담사(6~11rem) | 요약(남는 폭, 행 56rem 이상에서만 보임) | 오른쪽 고정 열. */
/**
 * 제목 행을 몇 벌 그려 두나 — 단마다 하나씩 서야 하는데 단 수는 폭이 정한다(CSS 다단). 그래서 제목 행은 다단과 **같은
 * 식**으로 단을 세는 `repeat(auto-fill, minmax(44rem, 1fr))` 격자에 여섯 벌을 넣고 첫 줄만 보이게 잘라 낸다(둘 다
 * `floor((폭 + 간격) ÷ (44rem + 간격))`이라 단 수·단 폭이 정확히 겹친다). 6벌 = 6단(약 4,400px)까지.
 */
const LIST_HEADER_COPIES = 6;
/**
 * 제목 행·테두리 격자의 열 — 목록의 단과 같은 수. `--cols`는 AutoPageSize가 "채울 수 있는 단 수"로 적어 준다(원장 2026-09-04 *"큰 창에서
 * 하나의 단에 학생 수가 너무 적다"* → 단을 위에서 아래로 채우고 남는 단은 세우지 않는다). 적히기 전(첫 페인트)엔 폭이 정하는 auto-fill.
 */
const COL_GRID = "repeat(var(--cols, auto-fill), minmax(min(44rem, 100%), 1fr))";
const ROW_GRID_VARS = {
  "--row-cols": `minmax(9rem,13rem) minmax(6rem,11rem) minmax(0,1fr) ${RIGHT_W_REM}rem`,
  "--right-cols": RIGHT_COLS_REM.map((r) => `${r}rem`).join(" "),
} as CSSProperties;

/**
 * 마우스 오버 전문 — 행에는 이름·학년·배지·시각만 남기고(원장 *"기본은 그냥 칸반"*) 요약·상담사·후속은 여기로
 * (등록상담 카드와 같은 규약: [column-cards.tsx](../enrollment/_components/column-cards.tsx)).
 * ⚠️ 툴팁은 손가락 기기에선 없는 것과 같다 — 행을 열면 상세에 전부 있으므로 폰에서도 한 번의 탭으로 닿는다.
 */
function hoverTextOf(c: StudentConsultationRow): string | undefined {
  const who = [c.subject, c.counselorName ? `${c.counselorName} 상담` : null].filter(Boolean).join(" · ");
  const followUp =
    c.followUpAction || c.followUpDate
      ? `후속 조치: ${c.followUpAction ?? "—"}${c.followUpDate ? ` · 기한 ${c.followUpDate}` : ""}${c.followUpDone ? " · 완료" : ""}`
      : null;
  const marks = [c.hasAudio ? "녹음 있음" : null, c.hasAi ? "AI 분석됨" : null].filter(Boolean).join(" · ");
  return (
    [
      `${c.studentName}${c.studentGrade ? ` (${c.studentGrade})` : ""}`,
      who || null,
      c.summary?.trim() || null,
      followUp,
      marks || null,
    ]
      .filter(Boolean)
      .join("\n\n") || undefined
  );
}

export default async function ConsultationsPage({
  searchParams,
}: {
  searchParams: Promise<{
    range?: RangeKey;
    cat?: CategoryKey;
    urg?: UrgencyKey;
    /** 상담사 `users.id`(원장 2026-09-09 *"상담 필터에 강사명도 있어야함."*). */
    who?: string;
    /** 과목 — 학원설정 **키**(`math`). 저장값은 한글 라벨이라 쿼리가 키·라벨 둘 다로 맞춘다. */
    subject?: string;
    q?: string;
    page?: string;
    size?: string;
  }>;
}) {
  await requireAccess("consultations");
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const cat: CategoryKey = (sp.cat as CategoryKey) ?? "all";
  const urg: UrgencyKey = (sp.urg as UrgencyKey) ?? "all";
  const who = sp.who ?? "";
  const subject = sp.subject ?? "";
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  // 쪽 크기: URL(이번 창의 측정값) → 기기 쿠키(지난번 측정값) → 기본값. 서버·클라 clamp가 같은 상수라 왕복하지 않는다.
  const jar = await cookies();
  const size = clampPageSize(sp.size ?? jar.get(pageSizeCookieName(PAGE_SIZE_KEY))?.value, DEFAULT_PAGE_SIZE);

  // 🔴 과목 선택지는 **학원설정 단일 소스**(하드코딩 금지) — 라벨도 여기서 나온다. 저장값이 한글 라벨이라
  //    쿼리에 라벨을 함께 넘겨 키·라벨 둘 다로 맞춘다(queries.ts 주석).
  const settings = await getTenantSettings();
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const [{ rows: items, total }, counts, counselorOptions] = await Promise.all([
    getStudentConsultationsPage(
      { q, range, cat, urg, counselor: who || undefined, subject: subject || undefined, subjectLabel: subject ? subjects.labelOf(subject) : null },
      page,
      size,
    ),
    getStudentConsultationCounts(),
    getConsultationCounselorOptions(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const { total: totalAll, lastWeek, pendingFollowUps, overdueFollowUps } = counts;

  // 현재 필터 보존 + page만 변경(필터 드롭다운은 FilterSelect 규약대로 page를 리셋한다).
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (range !== "all") params.set("range", range);
    if (cat !== "all") params.set("cat", cat);
    if (urg !== "all") params.set("urg", urg);
    if (who) params.set("who", who);
    if (subject) params.set("subject", subject);
    if (q) params.set("q", q);
    if (size !== DEFAULT_PAGE_SIZE) params.set("size", String(size));
    if (p > 1) params.set("page", String(p));
    const s = params.toString();
    return s ? `/consultations?${s}` : "/consultations";
  };

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* 핵심 수치 — 지시서 §4 "1차 화면에 남길 것: 현재 상태 + 핵심 KPI". */}
      <StatStrip>
        <BigStat label="전체 상담" value={totalAll} unit="건" tone="primary" icon={<MessagesSquare size={16} strokeWidth={1.8} />} />
        <BigStat label="최근 7일" value={lastWeek} unit="건" tone="blue" icon={<CalendarClock size={16} strokeWidth={1.8} />} />
        <BigStat label="진행 중 후속" value={pendingFollowUps} unit="건" tone="gold" icon={<BellRing size={16} strokeWidth={1.8} />} />
        <BigStat
          label="지연 후속"
          value={overdueFollowUps}
          unit="건"
          tone="danger"
          valueClass={overdueFollowUps > 0 ? "text-danger" : undefined}
          icon={<AlarmClock size={16} strokeWidth={1.8} />}
        />
      </StatStrip>

      {/* 목록 머리 — 지시서 §10: 상시 버튼은 Primary('상담 추가') 하나 + 텍스트 Secondary('통계') 하나.
          필터는 축마다 라벨 하나(드롭다운, `기간: 최근 7일`처럼 축이 붙어 읽힌다) · 검색은 눌러야 나온다.
          옛 칩 16개 툴바 두 줄은 걷었다.
          건수·필터·검색·주요 동작은 한 흐름으로 놓고 실제 폭이 부족할 때만 감싼다. */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
          <p className="text-text-dim text-sm whitespace-nowrap">
            결과 <span className="text-foreground font-bold">{total}</span>건
            {totalPages > 1 ? (
              <span className="num ml-1.5">
                · {page}/{totalPages}
              </span>
            ) : null}
          </p>
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <FilterSelect
            paramName="range"
            value={range === "all" ? "" : range}
            options={RANGE_OPTIONS}
            axisLabel="기간"
            ariaLabel="기간 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          <FilterSelect
            paramName="cat"
            value={cat === "all" ? "" : cat}
            options={CATEGORY_OPTIONS}
            axisLabel="카테고리"
            ariaLabel="카테고리 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          <FilterSelect
            paramName="urg"
            value={urg === "all" ? "" : urg}
            options={URGENCY_OPTIONS}
            axisLabel="후속"
            ariaLabel="후속 조치 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          {/* 상담사 — 실제로 상담을 쓴 사람만 선다(직원 명부 전체가 아니다). 강사 계정은 자기 것만 보여
              선택지가 없으므로 줄 자체를 감춘다(고를 것이 하나뿐인 필터는 자리만 차지한다). */}
          {counselorOptions.length > 0 ? (
          <FilterSelect
            paramName="who"
            value={who}
            options={counselorOptions.map((c) => ({ value: c.id, label: c.name }))}
            axisLabel="상담사"
            ariaLabel="상담사 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          ) : null}
          {/* 과목 — 선택지·라벨은 학원설정이 단일 소스(코드에 과목을 적지 않는다). */}
          <FilterSelect
            paramName="subject"
            value={subject}
            options={subjects.options}
            axisLabel="과목"
            ariaLabel="과목 필터"
            className="w-auto"
            triggerClassName={TOOLBAR_SELECT}
          />
          <SearchToggle placeholder="학생명·요약" defaultValue={q} />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <MakeeduSyncBadge domain="consultations" />
          <WindowLink
            href="/consultations/stats"
            title="상담 통계"
            className={`${CONTROL_H} ${CONTROL_LABEL} text-primary inline-flex items-center px-1 font-medium whitespace-nowrap hover:underline`}
          >
            통계
          </WindowLink>
          <NewConsultationTrigger />
        </div>
      </div>

      {total === 0 ? (
        <div className="mx-auto max-w-xl py-4">
          <PhotoCard
            src="/photos/consultations-hero.webp"
            alt=""
            caption="기록된 상담이 없습니다"
            sub="상담 추가로 첫 기록을 남겨 보세요"
            aspect="3/2"
            sizes="(max-width: 768px) 100vw, 576px"
          />
        </div>
      ) : (
        <>
          {/* 행 = 표처럼 열이 선다(원장 2026-09-03 *"좌우도 공간이 제법 많이 남으므로 … 과목과 상담자 등 뭘 더 보여주는 방안"*):
              이름(학년) | 과목 · 상담사 | 요약 한 줄(행이 넓을 때만) | 카테고리 | 후속 | 녹음·AI | 시각.
              행 사이는 헤어라인(§11 — 카드로 싸지 않는다), 행 전체가 상세 링크(§10 — 행 안 아이콘 버튼 금지, 삭제는 상세에).
              🔴 **단 수는 폭이 정한다**(CSS 다단, 한 단 최소 44rem): 최소 창 760 = 1단, ~1,500 = 2단, ~2,200 = 3단. 위→아래→다음 단.
              🔴 **행 수는 높이가 정한다**(AutoPageSize → ?size=N). 창=iframe이라 둘 다 창 크기에 그대로 반응한다. */}
          {/* AutoPageSize가 루트다 — 제목·테두리 격자와 목록이 같은 `--cols`(채울 수 있는 단 수)를 읽어야 해서 한 상자 안에 둔다.
              목록은 `data-autopage-list`로 찾는다(첫 자식이 아니어도 된다). */}
          <AutoPageSize size={size} rowPx={ROW_PX} storageKey={PAGE_SIZE_KEY} className="relative">
          {/* 단마다 테두리(원장 2026-09-03 *"단 구분선 말고 단마다 테두리"*) — 다단의 단은 요소가 아니라 테두리를 두를 수 없다. 제목 행과
              같은 격자로 **단 크기의 빈 상자**를 뒤에 깔고(제목 + 목록 높이) 그 위에 제목·목록을 얹는다 — 식이 같아 상자와 단이
              정확히 겹친다. 남는 벌은 auto-rows-[100%]로 둘째 줄에 밀려 잘린다. 링(shadow-card)은 상자 밖에 그려져 overflow에 잘리므로
              여기만 border([[#114]]). 행 선은 border-t·제목 행은 선 없음 — 마지막 행 밑에 선이 겹치지 않게. */}
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 grid auto-rows-[100%] gap-x-8 overflow-hidden"
            style={{ gridTemplateColumns: COL_GRID }}
          >
            {Array.from({ length: LIST_HEADER_COPIES }, (_, i) => (
              <div key={i} className="border-line rounded-lg border" />
            ))}
          </div>
          {/* 제목 행(원장 2026-09-03 *"학생 상담 제목행은 추가해주고"*) — 아래 행과 같은 열 격자(--row-cols/--right-cols)라 글자가
              열 위에 정확히 선다. 단마다 한 벌씩: 위 LIST_HEADER_COPIES 주석. 목록 위에 두면 제목 높이만큼 목록 위가 내려가 행 수가
              저절로 준다(AutoPageSize는 목록 위치를 실제 DOM에서 잰다). 첫 벌만 접근성 트리에. */}
          <div
            // auto-rows-[100%] — 둘째 줄(남는 벌)이 상자 높이(36px)에서 시작해야 잘려 나간다. 행 높이가 내용(24px)이면 둘째 줄 위 12px이 비친다(실측).
            className="relative grid h-9 auto-rows-[100%] gap-x-8 overflow-hidden"
            style={{ ...ROW_GRID_VARS, gridTemplateColumns: COL_GRID }}
            data-list-header=""
          >
            {Array.from({ length: LIST_HEADER_COPIES }, (_, i) => (
              <div key={i} aria-hidden={i > 0 ? "true" : undefined} className="@container/row">
                {/* 머리 라벨은 **그 열 본문과 같은 정렬**(원장 2026-09-04 *"열정렬 시켜줘"*): 글 열(학생·과목·요약)은 본문이 좌측이라 좌측,
                    칩 열(카테고리·후속·녹음·AI)은 본문 칩이 가운데라 가운데, 시각은 본문이 우측 끝이라 우측. 세로 구분선이 없는 행 격자라
                    라벨을 열 가운데에 띄우면 본문과 어긋나 보인다 — 테두리 있는 `<table>`의 "열 제목 가운데" 규약과 다른 갈래. */}
                <div className="text-text-dim grid h-full grid-cols-(--row-cols) items-center gap-3 px-2 text-sm font-bold">
                  <span className="text-left">학생</span>
                  <span className="text-left">과목 · 상담사</span>
                  <span className="hidden text-left @4xl/row:block">요약</span>
                  <div className="col-start-4 grid grid-cols-(--right-cols) items-center justify-items-center gap-1 whitespace-nowrap">
                    <span>카테고리</span>
                    <span>후속</span>
                    <span>녹음·AI</span>
                    <span className="justify-self-end">시각</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
            {/* 열 폭은 CSS 변수 두 개(위 ROW_GRID_VARS)로 한 번만 내려보내고 행·오른쪽 블록이 `grid-cols-(--var)`로 읽는다. */}
            {/* 단 채우기: column-count는 AutoPageSize의 `--cols`(적히기 전 auto = 폭이 정함), column-fill:auto는 높이(`--list-h`)를 고정해야
                듣는다 — 2단 이상일 때만 적히고 1단이면 auto(항목만큼). 폭 44rem 규칙은 그대로라 count와 폭 중 작은 쪽이 단 수다. */}
            <ul
              data-autopage-list=""
              className="columns-[44rem] gap-x-8 [&>li]:break-inside-avoid"
              // 🔴 `column-fill`도 변수로 받는다(기본 `balance`) — 상수 `auto`로 두면 **높이가 없는 모든 순간이 1단**이
              //    된다(측정 전 첫 페인트 + AutoPageSize가 높이를 못 적는 갈래). 원장 제보 2026-09-09
              //    *"카테고리를 바꾸고 다시 전체로 돌아오니까 3단이던게 1단으로"*가 정확히 그 상태였다.
              style={{
                ...ROW_GRID_VARS,
                columnCount: "var(--cols, auto)",
                // CSSProperties의 columnFill은 리터럴 유니온이라 변수를 못 받는다 — 값은 유효한 CSS다.
                columnFill: "var(--col-fill, balance)" as React.CSSProperties["columnFill"],
                height: "var(--list-h, auto)",
              }}
            >
              {items.map((c) => {
                const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
                const catMeta = c.category ? CATEGORY_META[c.category] : null;
                const isUrgent = urgency && (urgency.color === "danger" || urgency.color === "amber");
                const who = [c.subject, c.counselorName].filter(Boolean).join(" · ");
                return (
                  // @container/row — 요약 열은 이 행이 56rem(896px) 이상일 때만 선다(이름·과목 최대폭 + 오른쪽 열 + 간격 = 46.5rem이라
                  // 그보다 좁으면 요약 칸이 몇 글자짜리 토막이 된다). 단이 좁으면 이름·과목·배지만.
                  <li key={c.id} title={hoverTextOf(c)} className="@container/row border-line border-t">
                    {/* aria-label을 달지 않는다 — 달면 보조기기엔 이름만 남고 배지·시각이 사라진다(리뷰 확정 결함). 링크 본문이 곧 이름이다. */}
                    <WindowLink
                      href={`/consultations/${c.id}`}
                      title={c.studentName}
                      className={`hover:bg-bg-soft grid h-11 grid-cols-(--row-cols) items-center gap-3 rounded-lg px-2 transition ${
                        isUrgent ? "bg-danger-soft" : ""
                      }`}
                    >
                      {/* 이름 24px(등록상담 카드 28보다 한 단계 아래 — 원장 *"라벨 크기를 좀 적당하게"*), 학년 18px.
                          1차 핵심값이라 이 칸엔 이름·학년만 — 배지가 같이 서면 배지가 이름을 밀어 "김서연 (…"이 된다(리뷰 확정). */}
                      <p className="text-foreground min-w-0 truncate text-xl leading-none font-bold">
                        {c.studentName}
                        {c.studentGrade ? (
                          <span className="text-text-dim ml-1 text-base font-semibold">({c.studentGrade})</span>
                        ) : null}
                      </p>
                      {/* 과목 · 상담사 — 학생 상담이라 누가 무엇을 상담했는지가 이름 다음 정보다. 동기화·수정중 배지는 여기(2차 정보 칸)에. */}
                      <p className="text-text-dim flex min-w-0 items-center gap-1.5 text-sm font-medium">
                        <span className="min-w-0 truncate">{who}</span>
                        {c.syncAddedAt ? <MakeeduOriginTag /> : null}
                        <EditingBadge scope={`student-consultation:${c.id}`} />
                      </p>
                      {/* 요약 한 줄 — 2차 정보라 말줄임 허용(§1). 전문은 마우스 오버·상세. */}
                      <p className="text-text-faint hidden min-w-0 truncate text-sm @4xl/row:block" title={c.summary}>{consultationPreview(c.summary)}</p>
                      {/* 오른쪽은 **열**이다(원장 *"우측에 열정렬"*) — 카테고리 | 후속 | 녹음·AI | 시각, 칸 폭 고정이라 행마다
                          배지 수가 달라도 같은 자리에 선다. 빈 칸은 비워 둔다(자리를 당기지 않는다).
                          🔴 `col-start-4` — 요약 열이 숨는 폭(display:none = 그리드 아이템 없음)에서 이 블록이 3번째 트랙으로
                          자동 배치돼 오른쪽 끝에서 떠다니던 것(리뷰 확정). 자리는 늘 4번째 트랙. */}
                      <div className="col-start-4 grid grid-cols-(--right-cols) items-center justify-items-center gap-1">
                        <span>{catMeta ? <Pill color={catMeta.color}>{catMeta.label}</Pill> : null}</span>
                        <span>{urgency ? <Pill color={urgency.color}>{urgency.label}</Pill> : null}</span>
                        {/* 아이콘만으로 뜻을 전하지 않는다(§2) — 옆에 읽히는 글자를 둔다. */}
                        <span className="flex items-center gap-1.5">
                          {c.hasAudio ? (
                            <span className="text-primary inline-flex items-center gap-0.5 text-sm font-bold whitespace-nowrap">
                              <Mic className="size-4" />
                              녹음
                            </span>
                          ) : null}
                          {c.hasAi ? (
                            <span className="text-gold inline-flex items-center gap-0.5 text-sm font-bold whitespace-nowrap">
                              <Sparkles className="size-4" />
                              AI
                            </span>
                          ) : null}
                        </span>
                        <span className="num text-text-dim justify-self-end text-sm whitespace-nowrap">{relativeTimeKo(c.consultedAt)}</span>
                      </div>
                    </WindowLink>
                  </li>
                );
              })}
            </ul>
          </AutoPageSize>
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
