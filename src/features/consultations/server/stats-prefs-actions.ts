"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";
import { isDefaultHomeroomFilter, parseHomeroomFilter, parseHomeroomSortKey, type HomeroomFilter, type HomeroomSort, type HomeroomView } from "../homeroom-sort";
import { STATS_DIMS, STATS_METRICS, type StatsDimKey, type StatsMetric, type StatsUnit } from "../stats-model";

/**
 * 원생상담 통계 화면 보기 저장 — 누르는 순간([[#90]]) 본인 계정에(`users.ui_prefs.consultations`, 원장 *"모든 뷰 세팅은 계정 귀속"*).
 * 본인 표시 취향이라 로그인만 본다. 기본값(월·건수·상담사)이면 키를 지운다(빈 값이 쌓이지 않게).
 */
export async function saveConsultationStatsPrefs(p: {
  unit?: StatsUnit;
  metric?: StatsMetric;
  dim?: StatsDimKey;
  hrSort?: HomeroomSort;
  hrFilter?: HomeroomFilter;
  hrView?: HomeroomView;
}): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, unknown> = {};
  if (p.unit === "week" || p.unit === "month") patch.stats_unit = p.unit === "week" ? "week" : undefined;
  if (p.metric && STATS_METRICS.includes(p.metric)) patch.stats_metric = p.metric === "count" ? undefined : p.metric;
  if (p.dim && STATS_DIMS.includes(p.dim)) patch.stats_dim = p.dim === "counselor" ? undefined : p.dim;
  if (p.hrSort && parseHomeroomSortKey(p.hrSort.key) && (p.hrSort.dir === "asc" || p.hrSort.dir === "desc")) {
    const isDefault = p.hrSort.key === "name" && p.hrSort.dir === "asc";
    patch.hr_sort = isDefault ? undefined : p.hrSort.key;
    patch.hr_dir = isDefault ? undefined : p.hrSort.dir;
  }
  if (p.hrFilter) {
    const f = parseHomeroomFilter(p.hrFilter); // 클라가 준 값을 그대로 믿지 않는다 — 같은 파서로 다시 거른다.
    patch.hr_filter = isDefaultHomeroomFilter(f) ? undefined : f;
  }
  if (p.hrView === "table" || p.hrView === "gauge") patch.hr_view = p.hrView === "gauge" ? "gauge" : undefined;
  if (Object.keys(patch).length === 0) return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs("consultations", patch);
}
