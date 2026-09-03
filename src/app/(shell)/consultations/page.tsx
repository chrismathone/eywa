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
 * 한 쪽 = 15건 — 이 메뉴의 최소 창(760×640)에서 수치 띠·머리 두 줄을 빼면 행(44px)이 약 10개 보인다.
 * 15건이면 1.5화면(옛 50건은 5화면). 원장 *"너무 스크롤 길어지지 않게"*.
 */
const PAGE_SIZE = 15;

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
  }>;
}) {
  await requireAccess("consultations");
  const sp = await searchParams;
  const range: RangeKey = (sp.range as RangeKey) ?? "all";
  const cat: CategoryKey = (sp.cat as CategoryKey) ?? "all";
  const urg: UrgencyKey = (sp.urg as UrgencyKey) ?? "all";
  const q = sp.q ?? "";
  const page = Math.max(1, Number(sp.page) || 1);

  const [{ rows: items, total }, counts] = await Promise.all([
    getStudentConsultationsPage({ q, range, cat, urg }, page, PAGE_SIZE),
    getStudentConsultationCounts(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const { total: totalAll, lastWeek, pendingFollowUps, overdueFollowUps } = counts;

  // 현재 필터 보존 + page만 변경(필터 드롭다운은 FilterSelect 규약대로 page를 리셋한다).
  const pageHref = (p: number) => {
    const params = new URLSearchParams();
    if (range !== "all") params.set("range", range);
    if (cat !== "all") params.set("cat", cat);
    if (urg !== "all") params.set("urg", urg);
    if (q) params.set("q", q);
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
          {/* 행 = 이름 + 값(배지·시각) 한 줄, 행 사이는 헤어라인(지시서 §11 — 각 행을 카드로 싸지 않는다).
              행 전체가 상담 상세로 가는 링크다(§10 "리스트 행 자체 클릭 · 행 오른쪽 아이콘 버튼 금지" — 삭제는 상세에). */}
          <ul className="divide-line divide-y">
            {items.map((c) => {
              const urgency = URGENCY_META[followUpUrgency(c.followUpDate, c.followUpDone)];
              const catMeta = c.category ? CATEGORY_META[c.category] : null;
              const isUrgent = urgency && (urgency.color === "danger" || urgency.color === "amber");
              return (
                <li key={c.id} title={hoverTextOf(c)}>
                  {/* aria-label을 달지 않는다 — 달면 보조기기엔 이름만 남고 배지·시각이 사라진다(리뷰 확정 결함). 링크 본문이 곧 이름이다. */}
                  <WindowLink
                    href={`/consultations/${c.id}`}
                    title={c.studentName}
                    className={`hover:bg-bg-soft flex h-11 items-center justify-between gap-3 px-2 transition ${
                      isUrgent ? "bg-danger-soft" : ""
                    }`}
                  >
                    {/* 글자 크기는 등록상담 카드와 같다(이름 2xl 28 · 학년 lg 20) — "동일하게"는 구조만이 아니라 크기도. */}
                    <p className="text-foreground flex min-w-0 items-center gap-1.5 text-2xl leading-none font-bold">
                      <span className="min-w-0 truncate">
                        {c.studentName}
                        {c.studentGrade ? (
                          <span className="text-text-dim ml-1 text-lg font-semibold">({c.studentGrade})</span>
                        ) : null}
                      </span>
                      {c.syncAddedAt ? <MakeeduOriginTag /> : null}
                      <EditingBadge scope={`student-consultation:${c.id}`} />
                    </p>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {catMeta ? <Pill color={catMeta.color}>{catMeta.label}</Pill> : null}
                      {urgency ? <Pill color={urgency.color}>{urgency.label}</Pill> : null}
                      {/* 아이콘만으로 뜻을 전하지 않는다(§2) — 옆에 읽히는 글자를 둔다. */}
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
                      <span className="num text-text-dim text-sm whitespace-nowrap">{relativeTimeKo(c.consultedAt)}</span>
                    </div>
                  </WindowLink>
                </li>
              );
            })}
          </ul>
          <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
        </>
      )}
    </div>
  );
}
