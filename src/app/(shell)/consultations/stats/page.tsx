import { Suspense } from "react";
import { requireAccess } from "@/lib/auth/require-access";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { isModuleEnabled } from "@/lib/modules";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { getConsultationCounselorOptions, withCounselorOption, type ConsultationListFilters } from "@/features/consultations/server/queries";
import { CONSULT_DEFAULT_PAGE_SIZE, consultationsHref, type ConsultationListParams } from "@/features/consultations/list-href";
import { clampPageSize } from "@/components/page-size";
import { ConsultationFilters } from "../_components/consultation-filters";
import { BackToListButton } from "../_components/back-to-list-button";
import { ConsultationStatsPanel } from "../_components/stats/stats-panel";
import { StatsPanelSkeleton } from "../_components/stats/stats-skeleton";

export const metadata = { title: "상담 통계 — 에이와" };

const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * 원생상담 **통계 화면**(원장 2026-10-01 *"상담 통계를 옆으로 두지말고 … 따로 통계 보기 버튼 만들고 이동시키던가"* —
 * 9-30의 '목록 옆 통계 패널'을 뒤집었다. 목록은 폭을 다 쓰고 위에 한 줄 요약 띠만 남는다).
 * 목록(`/consultations`)과 **같은 필터 주소 규약**(list-href.ts) — 기간·카테고리·후속·상담사·과목이 쿼리로 오가서 목록 ↔ 통계를 옮겨도
 * 그대로다. 검색어·쪽·쪽 크기는 통계에 쓰지 않고 주소에만 들고 있다가 '목록으로'에서 되살린다(보던 쪽으로 돌아간다).
 * 🔴 같은 창 안 이동 — 이동 부품(BackToListButton·EmbedLink·FilterSelect)이 `embed=1`을 싣는다([[#133]]).
 * 권한은 목록과 같은 `consultations` 게이트(강사는 본인 상담만 — stats.ts).
 */
export default async function ConsultationStatsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAccess("consultations");
  const sp = await searchParams;
  // 쪽·쪽 크기는 통계가 안 쓴다 — 목록에서 들고 온 값을 '목록으로'에 그대로 돌려주려고만 읽는다(목록과 같은 clamp).
  const listParams: ConsultationListParams = {
    range: one(sp.range) || "all",
    cat: one(sp.cat) || "all",
    urg: one(sp.urg) || "all",
    who: one(sp.who),
    subject: one(sp.subject),
    q: one(sp.q),
    size: clampPageSize(one(sp.size) || undefined, CONSULT_DEFAULT_PAGE_SIZE),
    page: Math.max(1, Number(one(sp.page)) || 1),
  };
  const [settings, baseCounselorOptions, teacherId] = await Promise.all([getTenantSettings(), getConsultationCounselorOptions(), effectiveTeacherId()]);
  // 상담 0건 담임으로 들어와도(요약 띠 [담임별]) 상담사 칸·범위 문구에 이름이 선다.
  const counselorOptions = await withCounselorOption(baseCounselorOptions, listParams.who);
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const filters: ConsultationListFilters = {
    q: "", // 검색어는 통계에 걸지 않는다(집계 RPC에 없다 · 목록 위 요약 띠도 같은 조건).
    range: listParams.range as ConsultationListFilters["range"],
    cat: listParams.cat as ConsultationListFilters["cat"],
    urg: listParams.urg as ConsultationListFilters["urg"],
    counselor: listParams.who || undefined,
    subject: listParams.subject || undefined,
    subjectLabel: listParams.subject ? subjects.labelOf(listParams.subject) : null,
  };
  // makeedu가 꺼진 학원엔 '동기화' 지표·축이 없다(기능 스위치 = 흔적 없이).
  const syncOn = isModuleEnabled(settings.modules.disabled, "makeedu");

  return (
    // @container/panel — 통계 격자(stats-skeleton.tsx STATS_PANEL_GRID)가 이 폭으로 1·2·3칸을 고른다.
    <div className="@container/panel space-y-5 compact-chrome:space-y-3">
      {/* 머리 — 왼쪽 '목록으로'(필터를 들고 간다) + 목록과 같은 필터 드롭다운. 검색·상담 추가는 목록 쪽 일이라 두지 않는다. */}
      <div className="flex flex-wrap items-center gap-2 px-1">
        <BackToListButton href={consultationsHref(listParams, CONSULT_DEFAULT_PAGE_SIZE)} />
        <ConsultationFilters
          range={listParams.range}
          cat={listParams.cat}
          urg={listParams.urg}
          who={listParams.who}
          subject={listParams.subject}
          // 퇴사자는 고르기에서 뺀다(원장 2026-10-27 *"상담통계 퇴사자제외"*) — 주소로 이미 골라 들어온 사람만 남겨 선택이 비지 않게.
          counselorOptions={counselorOptions.filter((c) => !c.retired || c.id === listParams.who)}
          subjectOptions={subjects.options}
        />
      </div>
      <Suspense fallback={<StatsPanelSkeleton />}>
        <ConsultationStatsPanel
          filters={filters}
          listParams={listParams}
          whoLabel={counselorOptions.find((c) => c.id === listParams.who)?.name ?? null}
          teacherScoped={!!teacherId}
          syncOn={syncOn}
        />
      </Suspense>
    </div>
  );
}
