
import { SheetText } from "@/features/teacher-view/interface-label";
import { Suspense } from "react";
import { MessagesSquare, CalendarClock, BellRing, AlarmClock } from "@/components/icons/aywa-icon-compat";
import { BigStat } from "@/components/atoms/big-stat";
import { StatStrip } from "@/components/atoms/stat-strip";
import { MakeeduSyncBadge } from "@/components/makeedu-sync-badge";
import { PhotoCard } from "@/components/atoms/photo-card";
import { requireAccess } from "@/lib/auth/require-access";
import { canManageTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
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
import {
  CONSULT_DEFAULT_PAGE_SIZE,
  consultationsHref,
  consultationsStatsHref,
  type ConsultationListParams,
} from "@/features/consultations/list-href";
import { Pagination } from "@/components/pagination";
import { NewConsultationTrigger } from "./_components/new-consultation-trigger";
import { SearchToggle } from "@/components/search-toggle";
import { clampPageSize, pageSizeCookieName } from "@/components/page-size";
import { cookies } from "next/headers";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { ConsultationList } from "./_components/consultation-list";
import { ConsultationFilters } from "./_components/consultation-filters";
import { ConsultationStatsSummary, StatsSummarySkeleton } from "./_components/stats-summary";
import { EmbedLink } from "@/components/embed-link";
import { CONTROL_H, CONTROL_LABEL } from "@/components/ui/control-scale";

export const metadata = { title: "원생상담 — 에이와" };

type RangeKey = "all" | "7d" | "30d";
type CategoryKey = "all" | StudentConsultationCategory;
type UrgencyKey = "all" | "overdue" | "today" | "soon" | "later" | "done";

/**
 * 한 쪽의 행 수는 **창이 정한다**(원장 2026-09-03 *"창 크기에 따라서 스마트하게 유동성 있게"*): [AutoPageSize](@/components/auto-page-size)가
 * 목록 아래 남는 높이로 한 단 행 수를 재어 `?size=N`(= 한 단 행 수 × 2)으로 다시 청하고 그 값을 기기 쿠키에 남긴다. 서버는 URL → 쿠키 →
 * 이 기본값 순으로 읽고 같은 범위([page-size.ts](@/components/page-size))로 clamp한다(왕복 방지).
 * 🔴 쪽 크기는 **단 수와 무관**하다(원장 2026-09-30 *"페이지당 건수는 단 수와 무관하게 일정"*) — 단이 하나면 목록이 그만큼 길어진다.
 * 기본값은 list-href.ts `CONSULT_DEFAULT_PAGE_SIZE`(통계 화면의 '목록으로'도 같은 값을 읽는다).
 */
const DEFAULT_PAGE_SIZE = CONSULT_DEFAULT_PAGE_SIZE;
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
  const [{ rows: items, total, classSupported, failed: listFailed }, counts, counselorOptions, canImportExcel, teacherId, canWrite] = await Promise.all([
    getStudentConsultationsPage(filters, page, size),
    getStudentConsultationCounts(),
    getConsultationCounselorOptions(),
    // 엑셀로 넣기 = 학원 전체 일괄 작업 → full만(올리기 주소도 같은 판정 — [[#77]]).
    canManageTenant(user.systemRole, "consultations"),
    effectiveTeacherId(),
    // '상담 추가' = 저장 게이트(createStudentConsultation)와 같은 판정 — 읽기 권한이면 단추를 그리지 않는다(원장 2026-11-05).
    canWriteTenant(user.systemRole, "consultations"),
  ]);
  const totalPages = Math.max(1, Math.ceil(total / size));
  const { thisMonth, lastWeek, pendingFollowUps, overdueFollowUps } = counts;
  const listParams: ConsultationListParams = { range, cat, urg, who, subject, q, size, page };
  // 현재 필터 보존 + page만 변경(필터 드롭다운은 FilterSelect 규약대로 page를 리셋한다).
  const pageHref = (p: number) => consultationsHref({ ...listParams, page: p }, DEFAULT_PAGE_SIZE);
  // makeedu가 꺼진 학원엔 '동기화' 지표·축이 없다(기능 스위치 = 흔적 없이).
  const syncOn = isModuleEnabled(settings.modules.disabled, "makeedu");

  return (
    // 컴팩트 크롬(창·모바일·강사 미니셸)에선 섹션 간격을 좁힌다(원장 지시 2026-08-06 "남는 공간 많음").
    <div className="space-y-5 compact-chrome:space-y-3">
      {/* 핵심 수치 — 지시서 §4 "1차 화면에 남길 것: 현재 상태 + 핵심 KPI". 필터와 무관한 학원 전체 값(아래 요약 띠는 필터를 따른다). */}
      <StatStrip>
        {/* 누적 '전체 상담' 대신 이번 달(원장 2026-10-30 *"전체 상담 N건은 사실상 크게 궁금하지 않음"*). */}
        <BigStat label="이번 달 상담" value={thisMonth} unit="건" tone="primary" icon={<MessagesSquare size={16} strokeWidth={1.8} />} />
        <BigStat label="최근 7일" value={lastWeek} unit="건" tone="blue" icon={<CalendarClock size={16} strokeWidth={1.8} />} />
        <BigStat label="진행 중 후속" value={pendingFollowUps} unit="건" tone="gold" icon={<BellRing size={16} strokeWidth={1.8} />} />
        <BigStat
          label="기한 경과 후속"
          value={overdueFollowUps}
          unit="건"
          tone="danger"
          valueClass={overdueFollowUps > 0 ? "text-danger" : undefined}
          icon={<AlarmClock size={16} strokeWidth={1.8} />}
        />
      </StatStrip>

      {/* 목록 머리 — Primary는 '상담 추가' 하나, '통계 보기'는 텍스트 보조(같은 창 안 이동 — 필터 유지).
          필터는 축마다 라벨 하나(드롭다운) · 검색은 눌러야 나온다. 통계는 목록 옆 패널이 아니라 전용 화면(원장 2026-10-01). */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-1">
        <p className="text-text-dim text-sm whitespace-nowrap">
          <SheetText value={"결과 "} /><span className="text-foreground font-bold">{total}</span><SheetText value={"건"} />{totalPages > 1 ? (
            <span className="num ml-1.5">
              · {page}/{totalPages}
            </span>
          ) : null}
        </p>
        {/* phone:basis-full — 폰에선 flex-1(basis 0)이 건수 옆 남는 74px에 이 묶음을 세워 드롭다운 5개가 한 줄에 하나씩
            세로로 쌓였다(2026-09-13 모바일 전수검사). 제 줄로 내려 전폭에서 감기게 한다(창 안은 종전 한 줄). */}
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 phone:basis-full">
          <ConsultationFilters
            range={range}
            cat={cat}
            urg={urg}
            who={who}
            subject={subject}
            counselorOptions={counselorOptions}
            subjectOptions={subjects.options}
          />
          <SearchToggle placeholder="학생명·요약" defaultValue={q} />
          {/* 엑셀 가져오기(원생상담) — 검색과 같은 줄(원장 2026-09-29 통일). */}
          {canImportExcel ? <ExcelMenu importKind="student-consultations" /> : null}
        </div>
        <div className="ml-auto flex items-center gap-3">
          <MakeeduSyncBadge domain="consultations" />
          {/* 텍스트 보조 버튼(§10 — 상시 버튼은 Primary 하나 + 텍스트 하나). 같은 창 안 이동이라 창이면 embed를 싣는다([[#133]]). */}
          <EmbedLink
            href={consultationsStatsHref(listParams)}
            title="상담 통계 — 지금 필터 그대로"
            className={`${CONTROL_H} ${CONTROL_LABEL} text-primary inline-flex items-center px-1 font-medium whitespace-nowrap hover:underline`}
          >
            <SheetText value={"통계 보기"} /></EmbedLink>
          {canWrite ? <NewConsultationTrigger /> : null}
        </div>
      </div>

      {/* 한 줄 요약 띠 — 지금 걸린 필터를 따르는 핵심 수치(통계 화면과 같은 함수). 집계는 목록 첫 페인트를 막지 않는다(B7) —
          스켈레톤과 실표면이 같은 한 줄 높이라 늦게 와도 목록이 안 밀린다(stats-summary.tsx). */}
      <Suspense fallback={<StatsSummarySkeleton />}>
        <ConsultationStatsSummary
          filters={filters}
          listParams={listParams}
          whoLabel={counselorOptions.find((c) => c.id === who)?.name ?? null}
          teacherScoped={!!teacherId}
          syncOn={syncOn}
          viewerKey={`${user.id}:${teacherId ?? ""}`}
        />
      </Suspense>

      {/* 목록 — 화면 폭을 다 쓴다(넓으면 2단, 좁으면 1단 · consultation-list.tsx). 통계는 옆 패널이 아니라 '통계 보기' 전용 화면(원장 2026-10-01). */}
      <div data-autopage-root="">
        {listFailed ? (
          // 조회 실패는 "상담 0건"이 아니다(B3) — 없다고 말하지 않고 다시 시도를 안내한다.
          <p role="alert" className="border-danger/30 bg-danger-soft text-danger rounded-xl border px-4 py-2.5 text-sm">
            상담 목록을 불러오지 못했습니다 — 잠시 뒤 새로 고쳐 주세요.
          </p>
        ) : total === 0 ? (
          <div className="mx-auto max-w-xl py-4">
            <PhotoCard
              src="/photos/consultations-hero.webp"
              alt=""
              caption="기록된 상담이 없습니다"
              sub={canWrite ? "상담 추가로 첫 기록을 남겨 보세요" : undefined}
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
    </div>
  );
}
