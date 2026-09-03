import { MessagesSquare, CalendarClock, BellRing, AlarmClock, Mic, Sparkles } from "@/components/icons/eywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
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

export const metadata = { title: "학생상담 — eywa" };

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
 * 기본값 7 = 창을 처음 여는 크기(= 최소 창 760×640, 본문 601px)에서 실측한 행 수 — 쿠키가 없는 첫 방문에도 다시 청하지 않게.
 */
const DEFAULT_PAGE_SIZE = 7;
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
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  // 쪽 크기: URL(이번 창의 측정값) → 기기 쿠키(지난번 측정값) → 기본값. 서버·클라 clamp가 같은 상수라 왕복하지 않는다.
  const jar = await cookies();
  const size = clampPageSize(sp.size ?? jar.get(pageSizeCookieName(PAGE_SIZE_KEY))?.value, DEFAULT_PAGE_SIZE);

  const [{ rows: items, total }, counts] = await Promise.all([
    getStudentConsultationsPage({ q, range, cat, urg }, page, size),
    getStudentConsultationCounts(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const { total: totalAll, lastWeek, pendingFollowUps, overdueFollowUps } = counts;

  // 현재 필터 보존 + page만 변경(필터 드롭다운은 FilterSelect 규약대로 page를 리셋한다).
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (range !== "all") params.set("range", range);
    if (cat !== "all") params.set("cat", cat);
    if (urg !== "all") params.set("urg", urg);
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
      <section className="grid grid-cols-2 gap-3.5 sm:grid-cols-4">
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
      </section>

      {/* 목록 머리 — 지시서 §10: 상시 버튼은 Primary('상담 추가') 하나 + 텍스트 Secondary('통계') 하나.
          필터는 축마다 라벨 하나(드롭다운, `기간: 최근 7일`처럼 축이 붙어 읽힌다) · 검색은 눌러야 나온다.
          옛 칩 16개 툴바 두 줄은 걷었다.
          ⚠️ 두 줄(숫자+동작 / 필터)로 **일부러** 나눈다 — 한 줄에 다 넣으면 이 메뉴의 최소 창(760px)에서
          줄이 감기며 Primary가 둘째 줄 왼쪽에 매달린다(리뷰 확정 결함). */}
      <div className="space-y-2 px-1">
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <p className="text-text-dim text-sm whitespace-nowrap">
            결과 <span className="text-foreground font-bold">{total}</span>건
            {totalPages > 1 ? (
              <span className="num ml-1.5">
                · {page}/{totalPages}
              </span>
            ) : null}
          </p>
          <div className="flex items-center gap-3">
            <MakeeduSyncBadge domain="consultations" />
            {/* 텍스트 Secondary — 치수는 옆 Primary와 같은 control-scale(한 줄에서 밑선이 맞아야 한다). */}
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
        <div className="flex flex-wrap items-center gap-2">
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
          <SearchToggle placeholder="학생명·요약" defaultValue={q} />
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
          <AutoPageSize size={size} rowPx={ROW_PX} storageKey={PAGE_SIZE_KEY}>
            {/* 열 폭은 CSS 변수 두 개(위 ROW_GRID_VARS)로 한 번만 내려보내고 행·오른쪽 블록이 `grid-cols-(--var)`로 읽는다. */}
            <ul className="columns-[44rem] gap-x-8 [&>li]:break-inside-avoid" style={ROW_GRID_VARS}>
              {items.map((c) => {
                const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
                const catMeta = c.category ? CATEGORY_META[c.category] : null;
                const isUrgent = urgency && (urgency.color === "danger" || urgency.color === "amber");
                const who = [c.subject, c.counselorName].filter(Boolean).join(" · ");
                return (
                  // @container/row — 요약 열은 이 행이 56rem(896px) 이상일 때만 선다(이름·과목 최대폭 + 오른쪽 열 + 간격 = 46.5rem이라
                  // 그보다 좁으면 요약 칸이 몇 글자짜리 토막이 된다). 단이 좁으면 이름·과목·배지만.
                  <li key={c.id} title={hoverTextOf(c)} className="@container/row border-line border-b">
                    {/* aria-label을 달지 않는다 — 달면 보조기기엔 이름만 남고 배지·시각이 사라진다(리뷰 확정 결함). 링크 본문이 곧 이름이다. */}
                    <WindowLink
                      href={`/consultations/${c.id}`}
                      title={c.studentName}
                      className={`hover:bg-bg-soft grid h-11 grid-cols-(--row-cols) items-center gap-3 px-2 transition ${
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
                      <p className="text-text-faint hidden min-w-0 truncate text-sm @4xl/row:block">{c.summary}</p>
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
