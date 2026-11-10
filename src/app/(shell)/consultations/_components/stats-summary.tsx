import { getTenantSettings } from "@/features/owner/server/queries";
import { getConsultationStats } from "@/features/consultations/server/stats";
import type { ConsultationListFilters } from "@/features/consultations/server/queries";
import type { ConsultationListParams } from "@/features/consultations/list-href";
import { buildKpiLines, fmt } from "@/features/consultations/stats-kpi";
import { changeText, recentWeekTrend } from "@/features/consultations/stats-recent";
import { statsScopeText } from "@/features/consultations/stats-scope";
import type { StatsMetric } from "@/features/consultations/stats-model";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { HomeroomBand } from "./homeroom-band";

/**
 * 띠 상자 — 실표면·스켈레톤·오류 모두 **같은 한 줄 높이**(h-9). 띠는 목록보다 늦게 흘러오므로(B7) 도착해서 높이가 바뀌면
 * 목록이 밀리고, 창 높이로 행 수를 잰 AutoPageSize가 그만큼 어긋나 페이지에 스크롤이 생긴다(원장 *"스크롤이 따로 놀게"* 의 재발).
 * 그래서 줄을 바꾸지 않는다 — 좁은 폭에선 아래 SHOW_FROM 순서대로 지표를 덜 싣는다.
 * 기간·범위·'검색어 제외' 문구는 띠에 적지 않고 마우스 오버로만 둔다(원장 2026-11-11 *"보조멘트 제거"* — 그 전엔 띠 맨 앞 작은 글씨였다).
 */
const BAND = "@container/band bg-bg-soft flex h-9 items-center gap-4 overflow-hidden rounded-lg px-3";

/**
 * 띠 폭(`@container/band`)에 따라 싣는 지표 — 앞 지표의 폭 합이 들어가는 경계(2026-11-11 기간·범위 문구 13rem이 빠져 12rem씩 당김 · Pretendard 16px 실측 근사:
 * 최근 4주 ≈160 · 담임 상담 이번 달+[담임별] ≈220 · 후속 ≈132 · 녹음·AI ≈186 · 동기화 ≈132 · 반 없는 상담 ≈116px, 간격 16px).
 * 숨긴 지표는 '통계 보기'에 다 있다.
 * 🔴 누적 '상담 N건'·'1인당 상담'은 띠에서 뺐다(원장 2026-10-30 *"전체 건수는 숨기고 담임별 상담 건수 등 최근 추세에 대해서"*) —
 *    통계 화면 지표 카드에는 그대로 있다. 0318a 전(추이 없음)엔 건수를 대신 싣는다(1인당은 늘 숨김).
 */
const SHOW_FROM: Record<StatsMetric, string> = {
  count: "flex",
  perStudent: "hidden",
  follow: "hidden @min-[38rem]/band:flex",
  media: "hidden @min-[51rem]/band:flex",
  sync: "hidden @min-[60rem]/band:flex",
  class: "hidden @min-[68rem]/band:flex",
};
const HOMEROOM_FROM = "hidden @min-[29rem]/band:flex";

/** 요약 띠 자리 — 집계가 흘러오기 전에 같은 높이의 빈 띠를 먼저 세운다(B7 · 높이 = 실표면이라 도착해도 목록이 안 밀린다). */
export function StatsSummarySkeleton() {
  return <div aria-hidden="true" className="bg-bg-soft/40 h-9 animate-pulse rounded-lg" />;
}

/**
 * 목록 위 **한 줄 요약 띠**(원장 2026-10-01 — 통계 패널을 목록 옆에서 걷고 목록은 폭을 다 쓴다). 지금 걸린 기간·범위 필터를 그대로 따르고
 * 수치·문구는 통계 화면과 **같은 함수**(`getConsultationStats` · `buildKpiLines` · `statsScopeText`)로 만든다 — 같은 필터에서 두 표면의
 * 숫자가 갈리지 않는다. 검색어는 통계처럼 걸지 않는다('검색어 제외'). 자세한 건 툴바의 '통계 보기'(같은 동작을 두 곳에 두지 않는다).
 * 🔴 집계가 실패해도 **목록은 산다** — 여기서 던지지 않고 띠 자리에 한 줄만 알린다(같은 높이).
 */
export async function ConsultationStatsSummary({
  filters,
  listParams,
  whoLabel,
  teacherScoped,
  syncOn,
  viewerKey,
}: {
  filters: ConsultationListFilters;
  listParams: ConsultationListParams;
  whoLabel: string | null;
  teacherScoped: boolean;
  syncOn: boolean;
  /** 보는 사람(계정 + 보는 강사) — 담임 칸의 브라우저 기억 키(homeroom-band.tsx). */
  viewerKey: string;
}) {
  let loaded;
  try {
    // 검색어 빼고 — 통계 화면과 같은 조건(RPC는 검색어를 모른다; 대체 경로의 헤드 카운트도 같게).
    loaded = await Promise.all([getConsultationStats({ ...filters, q: "" }), getTenantSettings()]);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    console.error("[consultations] 요약 띠 조회 실패:", raw);
    return (
      // 한 줄 말줄임 — 띠 높이(h-9)를 넘겨 접히면 위아래가 잘린다(좁은 폰).
      <p className={`${BAND} text-muted-foreground text-xs`} title={raw}>
        <span className="min-w-0 truncate">상담 요약을 불러오지 못했습니다 — 목록은 그대로 볼 수 있습니다.</span>
      </p>
    );
  }
  const [stats, settings] = loaded;
  const subjects = buildSubjectMaps(settings.operations.subjects);
  const { period, scope, searchExcluded } = statsScopeText(stats, listParams, {
    teacherScoped,
    whoLabel,
    subjectLabel: listParams.subject ? subjects.labelOf(listParams.subject) : null,
  });
  // 추이가 있으면(full) 누적 건수·1인당 대신 최근 4주 — 없으면(0318a 전) 건수라도.
  const lines = buildKpiLines(stats, { syncOn, classOn: stats.full }).filter(
    (l) => !stats.full || (l.metric !== "count" && l.metric !== "perStudent"),
  );
  const trend = stats.full ? recentWeekTrend(stats.buckets.week, stats.today) : null;
  const change = trend ? changeText(trend.changePct) : null;
  return (
    // 기간·범위 문구('전체 기간 · 학원 전체')는 띠에 적지 않는다(원장 2026-11-11 *"보조멘트 제거"*) — 마우스 오버로만(검색어를 통계에 안 건다는 것도 여기).
    <section
      aria-label="상담 통계 요약"
      className={BAND}
      title={`${period} · ${scope}${searchExcluded ? " · 검색어는 통계에 걸지 않습니다(위 '결과'와 건수가 다를 수 있습니다)" : ""}`}
    >
      <ul className="flex shrink-0 items-baseline gap-4">
        {trend ? (
          <li
            className="flex items-baseline gap-1 text-sm whitespace-nowrap"
            title={`${md(trend.from)}~${md(trend.to)} · 직전 4주 ${fmt(trend.prior)}건 · 이번 주(진행 중) ${fmt(trend.thisWeek)}건 · 기간 필터와 무관하게 최근 주 기준(나머지 필터는 따른다)`}
          >
            <span className="font-medium">최근 4주</span>
            <span className="num text-foreground font-bold">{fmt(trend.recent)}건</span>
            {change ? (
              <span className={`num text-xs ${trend.changePct !== null && trend.changePct < 0 ? "text-danger" : "text-muted-foreground"}`}>
                {change}
              </span>
            ) : null}
          </li>
        ) : null}
        {/* 담임 상담 — 무거운 조회라 브라우저가 한 번 불러 몇 분 기억한다(homeroom-band.tsx). 목록 필터와 무관한 값이라
            상담사·과목이 걸린 띠에선 빼 둔다(걸린 숫자와 안 걸린 숫자가 한 줄에 섞이면 오독 — 리뷰 2026-10-30). */}
        {!listParams.who && !listParams.subject ? <HomeroomBand className={HOMEROOM_FROM} viewerKey={viewerKey} /> : null}
        {lines.map((l) => (
          <li key={l.metric} className={`${SHOW_FROM[l.metric]} items-baseline gap-1 text-sm whitespace-nowrap`} title={l.sub}>
            <span className="font-medium">{l.label}</span>
            <span className="num text-foreground font-bold">{l.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

const md = (ymd: string) => `${Number(ymd.slice(5, 7))}/${Number(ymd.slice(8))}`;
