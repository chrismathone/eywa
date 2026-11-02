import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { CONSULTATION_AUDIENCE_LABEL, CONSULTATION_CATEGORY_LABEL } from "@/features/consultations/labels";
import {
  CONSULT_DEFAULT_PAGE_SIZE,
  consultationsHref,
  consultationsStatsHref,
  type ConsultationListParams,
} from "@/features/consultations/list-href";
import { getConsultationStats, getRetiredStaffIds } from "@/features/consultations/server/stats";
import { getHomeroomConsultStats } from "@/features/consultations/server/homeroom";
import { loadConsultationStatsPrefs } from "@/features/consultations/server/stats-prefs";
import type { ConsultationListFilters } from "@/features/consultations/server/queries";
import { statsScopeText } from "@/features/consultations/stats-scope";
import {
  STATS_DIMS,
  type StatsDimItem,
  type StatsDimKey,
  type StatsDimView,
} from "@/features/consultations/stats-model";
import { StatsPanelClient } from "./stats-panel-client";
import { StatsHomeroom } from "./stats-homeroom";
import { STATS_PANEL_GRID } from "./stats-skeleton";

/** 상담사별 분해·상담 공백 카드(원장 2026-10-28 숨김) — 다시 켤 때 이 값과 아래 `<StatsGap>` 주석을 함께 되살린다. */
const SHOW_BREAKDOWN_AND_GAP = false;

const DIM_LABEL: Record<StatsDimKey, string> = {
  counselor: "상담사",
  subject: "과목",
  class: "반",
  category: "카테고리",
  audience: "대상",
  source: "작성 경로",
};

/**
 * 원생상담 **통계 화면 본문**(원장 2026-09-30 *"모든 것을 관리 통계 추이 가능하게."* → 2026-10-01 *"상담 통계를 옆으로 두지말고…
 * 따로 통계 보기 버튼 만들고 이동시키던가"* — 목록 옆 패널을 걷고 `/consultations/stats` 전용 화면으로 되살렸다).
 *
 * 🔴 수치 옆에 **기간과 범위**를 늘 적는다(퇴원관리 결정과 같은 규약) — 필터가 걸렸는데 '전체'처럼 보이면 화면이 거짓말을 한다.
 *    문구는 목록 위 요약 띠와 같은 함수(`statsScopeText`)다.
 * 🔴 목록과 같은 조건(stats.ts 주석). 강사는 본인 상담만(목록과 같은 스코프 — 옛 통계 화면이 한 번 어긋났던 자리, queries.ts 주석).
 * 분해 줄을 누르면 **이 화면이** 그 값으로 걸러진다(통계 안에서 파고들기), 지표 옆 '기한 경과 N건'·'완료 보기'는 **목록**을 그 값으로 연다(할 일 목록).
 * 성능: 집계 RPC 두 번 + 설정 두 번을 병렬로(B4). 부모가 Suspense로 감싸 화면 틀(툴바)이 먼저 선다(B7).
 */
export async function ConsultationStatsPanel({
  filters,
  listParams,
  whoLabel,
  teacherScoped,
  syncOn,
}: {
  filters: ConsultationListFilters;
  listParams: ConsultationListParams;
  whoLabel: string | null;
  teacherScoped: boolean;
  syncOn: boolean;
}) {
  // 🔴 집계가 실패해도 **화면 틀은 산다** — 여기서 던지면 가장 가까운 오류 경계가 툴바('목록으로')째 갈아 끼운다. 본문 자리에만 한 줄 알린다.
  let loaded;
  try {
    loaded = await Promise.all([
      getConsultationStats(filters),
      loadConsultationStatsPrefs(),
      getTenantSettings(),
      getRetiredStaffIds(),
      // 담임별 현황은 실패해도 위 통계는 산다 — 그 카드 자리에만 알린다.
      getHomeroomConsultStats().catch((e: unknown) => {
        console.error("[consultations] 담임별 상담 현황 조회 실패:", e instanceof Error ? e.message : String(e));
        return null;
      }),
    ]);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[consultations] 통계 화면 조회 실패:", raw);
    return (
      <p className="text-muted-foreground border-line rounded-2xl border p-3 text-sm break-keep" title={raw}>
        상담 통계를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.
      </p>
    );
  }
  const [stats, prefs, settings, retiredIds, homeroom] = loaded;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  // 분해 줄 = 이 화면 안에서 거르기 / 지표 옆 링크 = 목록을 그 값으로 열기.
  const statsHref = (patch: Partial<ConsultationListParams>) => consultationsStatsHref(listParams, patch);
  // 🔴 지표 옆 '지연 N건'은 검색어 없이 센 숫자다 — 목록에 검색어를 실어 열면 "지연 5건"을 눌렀는데 "결과 1건"이 된다(이 화면엔
  //    검색창이 없어 보이지도 지워지지도 않는다, 적대 리뷰 2026-10-01). 그래서 검색어를 비워 연다.
  const listHref = (patch: Partial<ConsultationListParams>) => consultationsHref(listParams, CONSULT_DEFAULT_PAGE_SIZE, { ...patch, q: "" });

  const { period, scope, searchExcluded } = statsScopeText(stats, listParams, {
    teacherScoped,
    whoLabel,
    subjectLabel: listParams.subject ? subjects.labelOf(listParams.subject) : null,
  });
  // 반 칸이 있다 = 0318a가 적용돼 집계 RPC가 응답했다(full) — 목록의 반 지원 판정과 같은 마이그레이션이다.
  const classOn = stats.full;

  const unjudgedAny = stats.full && stats.totals.judged < stats.totals.n;
  const subjectKeyOf = (stored: string | null) =>
    stored ? (subjects.options.find((o) => o.value === stored || o.label === stored)?.value ?? null) : null;
  const row = (dim: StatsDimKey, it: StatsDimItem) => {
    const k = it.k;
    switch (dim) {
      case "counselor":
        return {
          label: it.label ?? (k ? "이름 없는 직원" : "상담사 없음"),
          href: k && !teacherScoped ? statsHref({ who: k }) : null,
          active: !!k && listParams.who === k,
        };
      case "subject": {
        const key = subjectKeyOf(k);
        return { label: key ? subjects.labelOf(key) : (k ?? "과목 없음"), href: key ? statsHref({ subject: key }) : null, active: !!key && listParams.subject === key };
      }
      case "class":
        // 반을 아직 찾아보지 않은 옛 기록(백필 전)은 저장된 반이 비어 '반 없음' 칸에 들어간다 — 그 사실을 라벨에 밝힌다.
        return { label: it.label ?? (k ? "이름 없는 반" : unjudgedAny ? "반 없음(아직 안 찾아본 옛 기록 포함)" : "반 없음"), href: null, active: false };
      case "category":
        return {
          label: (k && CONSULTATION_CATEGORY_LABEL[k]) || "분류 없음",
          href: k && CONSULTATION_CATEGORY_LABEL[k] ? statsHref({ cat: k }) : null,
          active: !!k && listParams.cat === k,
        };
      case "audience":
        return { label: (k && CONSULTATION_AUDIENCE_LABEL[k]) || "대상 없음", href: null, active: false };
      default:
        return { label: k === "sync" ? "동기화" : "앱 작성", href: null, active: false };
    }
  };
  // 꺼진 기능은 흔적 없이 — makeedu가 꺼진 학원엔 '작성 경로' 축이, 반 칸이 없으면(0318a 전) '반' 축이 없다.
  // 🔴 상담사별 분해·상담 공백 카드는 숨겼다(원장 2026-10-28 *"해당 영역 주석처리하고 [담임별 상담 현황]을 당겨줘"*) — 다시 켤 땐
  //    `SHOW_BREAKDOWN_AND_GAP`만 true로(상담 공백은 `getConsultationGap()`을 Promise.all에 되살리고 `<StatsGap>`을 다시 그린다).
  //    위 지표·추이는 이제 아래 담임별 상담 현황의 과목·담임 고르기를 따른다(stats-homeroom.tsx).
  const dims: StatsDimView[] = SHOW_BREAKDOWN_AND_GAP && stats.full
    ? STATS_DIMS.filter((d) => (d !== "source" || syncOn) && (d !== "class" || classOn)).map((d) => {
        const bucket = stats.dims[d];
        const items = bucket?.items ?? [];
        // 퇴사자는 상담사별 줄에서 뺀다(원장 2026-10-27) — 뺀 사람·건수는 각주에 밝힌다. 화면은 12줄까지(RPC는 넉넉히 준다).
        const retired = d === "counselor" ? items.filter((it) => it.k !== null && retiredIds.has(it.k)) : [];
        const kept = retired.length ? items.filter((it) => !(it.k !== null && retiredIds.has(it.k))) : items;
        const rows = kept.slice(0, 12);
        return {
          key: d,
          label: DIM_LABEL[d],
          distinct: Math.max(rows.length, (bucket?.distinct ?? 0) - retired.length),
          rows: rows.map((it) => ({ key: it.k ?? "∅", n: it.n, m: it.m ?? [], w: it.w ?? [], ...row(d, it) })),
          excluded: retired.length ? { people: retired.length, n: retired.reduce((a, it) => a + it.n, 0) } : null,
        };
      })
    : [];

  return (
    <section aria-label="상담 통계" className={STATS_PANEL_GRID}>
      <header className="col-span-full space-y-0.5">
        <h2 className="text-foreground text-base font-bold">상담 통계</h2>
        <p className="text-muted-foreground text-xs break-keep">
          {period} · {scope}
          {searchExcluded ? " · 검색어 제외('목록으로' 돌아가면 다시 걸린다)" : ""}
        </p>
      </header>
      <StatsPanelClient
        // 분해 원자료(dims)는 위에서 라벨·주소를 붙인 `dims`로 따로 넘긴다 — 같은 배열을 두 번 싣지 않게 비운다.
        stats={stats.full ? { ...stats, dims: {} } : stats}
        dims={dims}
        initialPrefs={prefs}
        syncOn={syncOn}
        classOn={classOn}
        overdueHref={listHref({ urg: "overdue" })}
        doneHref={listHref({ urg: "done" })}
      />
      {/* <StatsGap gap={gap} teacherScoped={teacherScoped} /> — 숨김(원장 2026-10-28, 위 SHOW_BREAKDOWN_AND_GAP 주석) */}
      <StatsHomeroom
        data={homeroom}
        teacherScoped={teacherScoped}
        initialSort={prefs.hrSort}
        initialFilter={prefs.hrFilter}
        initialView={prefs.hrView}
        linkedWho={listParams.who}
        linkedSubject={listParams.subject}
      />
    </section>
  );
}
