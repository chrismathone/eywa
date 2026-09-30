import { Suspense } from "react";
import { MessagesSquare, CalendarClock, BellRing, AlarmClock } from "@/components/icons/aywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { FilterSelect } from "@/components/filter-select";
import { TOOLBAR_SELECT } from "@/components/toolbar-controls";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { PhotoCard } from "@/components/atoms/photo-card";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { isModuleEnabled } from "@/lib/modules";
import { ExcelMenu } from "@/components/excel-import/excel-menu";
import {
  getConsultationCounselorOptions,
  getStudentConsultationCounts,
  getStudentConsultationsPage,
  type ConsultationListFilters,
  type StudentConsultationCategory,
} from "@/features/consultations/server/queries";
import { consultationsHref, type ConsultationListParams } from "@/features/consultations/list-href";
import { Pagination } from "@/components/pagination";
import { NewConsultationTrigger } from "./_components/new-consultation-trigger";
import { SearchToggle } from "@/components/search-toggle";
import { clampPageSize, pageSizeCookieName } from "@/components/page-size";
import { cookies } from "next/headers";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ConsultationList } from "./_components/consultation-list";
import { ConsultationStatsPanel } from "./_components/stats/stats-panel";
import { StatsPanelSkeleton } from "./_components/stats/stats-skeleton";
import layout from "./_components/consultations-layout.module.css";

export const metadata = { title: "원생상담 — 에이와" };

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
 * 목록 아래 남는 높이로 한 단 행 수를 재어 `?size=N`(= 한 단 행 수 × 2)으로 다시 청하고 그 값을 기기 쿠키에 남긴다. 서버는 URL → 쿠키 →
 * 이 기본값 순으로 읽고 같은 범위([page-size.ts](@/components/page-size))로 clamp한다(왕복 방지).
 * 🔴 쪽 크기는 **단 수와 무관**하다(원장 2026-09-30 *"페이지당 건수는 단 수와 무관하게 일정"*) — 단이 하나면 목록이 그만큼 길어진다.
 * 기본값 12 = 최소 창(760×640, 본문 601px)의 한 단 행 수 6 × 2 — 쿠키가 없는 첫 방문에도 다시 청하지 않게.
 */
const DEFAULT_PAGE_SIZE = 12;
const PAGE_SIZE_KEY = "consultations";

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
  const user = await requireAccess("consultations");
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
  const filters: ConsultationListFilters = {
    q,
    range,
    cat,
    urg,
    counselor: who || undefined,
    subject: subject || undefined,
    subjectLabel: subject ? subjects.labelOf(subject) : null,
  };
  const [{ rows: items, total, classSupported }, counts, counselorOptions, canImportExcel, teacherId] = await Promise.all([
    getStudentConsultationsPage(filters, page, size),
    getStudentConsultationCounts(),
    getConsultationCounselorOptions(),
    // 엑셀로 넣기 = 학원 전체 일괄 작업 → full만(올리기 주소도 같은 판정 — [[#77]]).
    canManageTenant(user.systemRole, "consultations"),
    effectiveTeacherId(),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const { total: totalAll, lastWeek, pendingFollowUps, overdueFollowUps } = counts;
  const listParams: ConsultationListParams = { range, cat, urg, who, subject, q, size, page };
  // 현재 필터 보존 + page만 변경(필터 드롭다운은 FilterSelect 규약대로 page를 리셋한다).
  const pageHref = (p: number) => consultationsHref({ ...listParams, page: p }, DEFAULT_PAGE_SIZE);
  // makeedu가 꺼진 학원엔 '동기화' 지표·축이 없다(기능 스위치 = 흔적 없이).
  const syncOn = isModuleEnabled(settings.modules.disabled, "makeedu");

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* 핵심 수치 — 지시서 §4 "1차 화면에 남길 것: 현재 상태 + 핵심 KPI". 필터와 무관한 학원 전체 값(패널은 필터를 따른다). */}
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

      {/* 목록 머리 — 상시 버튼은 Primary('상담 추가') 하나. 필터는 축마다 라벨 하나(드롭다운) · 검색은 눌러야 나온다.
          옛 '통계' 링크는 걷었다 — 통계는 이제 목록 오른쪽 패널에 늘 있다(원장 2026-09-30). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <p className="text-text-dim text-sm whitespace-nowrap">
          결과 <span className="text-foreground font-bold">{total}</span>건
          {totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
        </p>
        {/* phone:basis-full — 폰에선 flex-1(basis 0)이 건수 옆 남는 74px에 이 묶음을 세워 드롭다운 5개가 한 줄에 하나씩
            세로로 쌓였다(2026-09-13 모바일 전수검사). 제 줄로 내려 전폭에서 감기게 한다(창 안은 종전 한 줄). */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 phone:basis-full">
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
          {/* 엑셀 가져오기(원생상담) — 검색과 같은 줄(원장 2026-09-29 통일). */}
          {canImportExcel ? <ExcelMenu importKind="student-consultations" /> : null}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <MakeeduSyncBadge domain="consultations" />
          <NewConsultationTrigger />
        </div>
      </div>

      {/* 목록(왼쪽) + 통계 패널(오른쪽) — 두 경계(패널이 옆에 서는 폭 · 목록 2단 폭)는 layout CSS 머리주석. */}
      <div className={layout.layout}>
        <div className={layout.grid}>
          {/* data-autopage-root — AutoPageSize가 목록 아래 높이를 이 상자 안에서만 잰다(옆·아래 패널 높이가 행 수에 섞이지 않게). */}
          <div className={layout.list} data-autopage-root="">
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
                <ConsultationList items={items} size={size} pageSizeKey={PAGE_SIZE_KEY} classOn={classSupported} />
                <Pagination page={page} totalPages={totalPages} hrefForPage={pageHref} />
              </>
            )}
          </div>
          <aside className={`${layout.panel} @container/panel`}>
            {/* 통계는 목록 첫 페인트를 막지 않는다(B7) — 목록이 먼저 서고 패널은 뒤따라 흘러온다. */}
            <Suspense fallback={<StatsPanelSkeleton />}>
              <ConsultationStatsPanel
                filters={filters}
                listParams={listParams}
                defaultSize={DEFAULT_PAGE_SIZE}
                whoLabel={counselorOptions.find((c) => c.id === who)?.name ?? null}
                teacherScoped={!!teacherId}
                classOn={classSupported}
                syncOn={syncOn}
              />
            </Suspense>
          </aside>
        </div>
      </div>
    </div>
  );
}
