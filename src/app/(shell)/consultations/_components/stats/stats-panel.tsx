import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { CONSULTATION_AUDIENCE_LABEL, CONSULTATION_CATEGORY_LABEL } from "@/features/consultations/labels";
import { consultationsHref, type ConsultationListParams } from "@/features/consultations/list-href";
import { getConsultationGap, getConsultationStats } from "@/features/consultations/server/stats";
import { loadConsultationStatsPrefs } from "@/features/consultations/server/stats-prefs";
import type { ConsultationListFilters } from "@/features/consultations/server/queries";
import {
  dateSpanText,
  STATS_DIMS,
  type StatsDimItem,
  type StatsDimKey,
  type StatsDimView,
} from "@/features/consultations/stats-model";
import { StatsPanelClient } from "./stats-panel-client";
import { StatsGap } from "./stats-gap";
import { STATS_PANEL_GRID } from "./stats-skeleton";

const DIM_LABEL: Record<StatsDimKey, string> = {
  counselor: "상담사",
  subject: "과목",
  class: "반",
  category: "카테고리",
  audience: "대상",
  source: "작성 경로",
};
const RANGE_TEXT: Record<string, string> = { "7d": "최근 7일", "30d": "최근 30일" };
const URG_TEXT: Record<string, string> = { overdue: "지연", today: "오늘", soon: "3일 내", later: "예정", done: "완료" };

/**
 * 원생상담 오른쪽 **통계 패널**(원장 2026-09-30 *"우측에 상담 통계 고도화. 모든 것을 관리 통계 추이 가능하게."*) —
 * 옛 `/consultations/stats` 화면(카테고리 분포·월별 추세·상담 필요 학생)을 흡수했다(그 주소는 이제 목록으로 돌려보낸다).
 *
 * 🔴 수치 옆에 **기간과 범위**를 늘 적는다(퇴원관리 결정과 같은 규약) — 목록 필터가 걸렸는데 '전체'처럼 보이면 화면이 거짓말을 한다.
 * 🔴 목록과 같은 조건(stats.ts 주석). 강사는 본인 상담만(목록과 같은 스코프 — 옛 통계 화면이 한 번 어긋났던 자리, queries.ts 주석).
 * 성능: 집계 RPC 두 번 + 설정 두 번을 병렬로(B4). 목록 첫 페인트를 막지 않게 부모가 Suspense로 감싼다(B7).
 */
export async function ConsultationStatsPanel({
  filters,
  listParams,
  defaultSize,
  whoLabel,
  teacherScoped,
  classOn,
  syncOn,
}: {
  filters: ConsultationListFilters;
  listParams: ConsultationListParams;
  defaultSize: number;
  whoLabel: string | null;
  teacherScoped: boolean;
  classOn: boolean;
  syncOn: boolean;
}) {
  // 🔴 집계가 실패해도 **목록은 산다** — 여기서 던지면 가장 가까운 오류 경계가 목록째 갈아 끼운다. 패널 자리에만 한 줄 알린다.
  let loaded;
  try {
    loaded = await Promise.all([getConsultationStats(filters), getConsultationGap(), loadConsultationStatsPrefs(), getTenantSettings()]);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[consultations] 통계 패널 조회 실패:", raw);
    return (
      <p className="text-muted-foreground border-line rounded-2xl border p-3 text-sm break-keep" title={raw}>
        상담 통계를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.
      </p>
    );
  }
  const [stats, gap, prefs, settings] = loaded;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const href = (patch: Partial<ConsultationListParams>) => consultationsHref(listParams, defaultSize, patch);

  // 기간 — 전체면 실제로 잡힌 첫·마지막 상담일까지 적는다("언제부터의 수치인가").
  const span = stats.full && stats.totals.first && stats.totals.last ? dateSpanText(stats.totals.first, stats.totals.last) : null;
  const period = `${RANGE_TEXT[listParams.range] ?? "전체 기간"}${span ? `(${span})` : ""}`;
  const scopeBits = [
    teacherScoped ? "내가 기록한 상담" : null,
    listParams.cat !== "all" ? `카테고리 ${CONSULTATION_CATEGORY_LABEL[listParams.cat] ?? "—"}` : null,
    listParams.urg !== "all" ? `후속 ${URG_TEXT[listParams.urg] ?? "—"}` : null,
    !teacherScoped && listParams.who ? `상담사 ${whoLabel ?? "—"}` : null,
    listParams.subject ? `과목 ${subjects.labelOf(listParams.subject)}` : null,
  ].filter((v): v is string => !!v);
  const scope = scopeBits.length ? scopeBits.join(" · ") : "학원 전체";

  const unjudgedAny = stats.full && stats.totals.judged < stats.totals.n;
  const subjectKeyOf = (stored: string | null) =>
    stored ? (subjects.options.find((o) => o.value === stored || o.label === stored)?.value ?? null) : null;
  const row = (dim: StatsDimKey, it: StatsDimItem) => {
    const k = it.k;
    switch (dim) {
      case "counselor":
        return {
          label: it.label ?? (k ? "이름 없는 직원" : "상담사 없음"),
          href: k && !teacherScoped ? href({ who: k }) : null,
          active: !!k && listParams.who === k,
        };
      case "subject": {
        const key = subjectKeyOf(k);
        return { label: key ? subjects.labelOf(key) : (k ?? "과목 없음"), href: key ? href({ subject: key }) : null, active: !!key && listParams.subject === key };
      }
      case "class":
        // 아직 판정 안 한 옛 기록(백필 전)은 저장된 반이 비어 '미매핑' 칸에 들어간다 — 그 사실을 라벨에 밝힌다.
        return { label: it.label ?? (k ? "이름 없는 반" : unjudgedAny ? "미매핑(판정 전 포함)" : "미매핑"), href: null, active: false };
      case "category":
        return {
          label: (k && CONSULTATION_CATEGORY_LABEL[k]) || "분류 없음",
          href: k && CONSULTATION_CATEGORY_LABEL[k] ? href({ cat: k }) : null,
          active: !!k && listParams.cat === k,
        };
      case "audience":
        return { label: (k && CONSULTATION_AUDIENCE_LABEL[k]) || "대상 없음", href: null, active: false };
      default:
        return { label: k === "sync" ? "동기화" : "앱 작성", href: null, active: false };
    }
  };
  // 꺼진 기능은 흔적 없이 — makeedu가 꺼진 학원엔 '작성 경로' 축이, 반 칸이 없으면(0318a 전) '반' 축이 없다.
  const dims: StatsDimView[] = stats.full
    ? STATS_DIMS.filter((d) => (d !== "source" || syncOn) && (d !== "class" || classOn)).map((d) => {
        const bucket = stats.dims[d];
        return {
          key: d,
          label: DIM_LABEL[d],
          distinct: bucket?.distinct ?? 0,
          rows: (bucket?.items ?? []).map((it) => ({ key: it.k ?? "∅", n: it.n, m: it.m ?? [], w: it.w ?? [], ...row(d, it) })),
        };
      })
    : [];

  return (
    <section aria-label="상담 통계" className={STATS_PANEL_GRID}>
      <header className="col-span-full space-y-0.5">
        <h2 className="text-foreground text-base font-bold">상담 통계</h2>
        <p className="text-muted-foreground text-xs break-keep">
          {period} · {scope}
          {listParams.q ? " · 검색어는 통계에 걸지 않음" : ""}
        </p>
      </header>
      <StatsPanelClient
        // 분해 원자료(dims)는 위에서 라벨·주소를 붙인 `dims`로 따로 넘긴다 — 같은 배열을 두 번 싣지 않게 비운다.
        stats={stats.full ? { ...stats, dims: {} } : stats}
        dims={dims}
        initialPrefs={prefs}
        syncOn={syncOn}
        classOn={classOn}
        overdueHref={href({ urg: "overdue" })}
        doneHref={href({ urg: "done" })}
      />
      <StatsGap gap={gap} teacherScoped={teacherScoped} />
    </section>
  );
}
