"use server";

import { patchMyUiPrefs } from "@/lib/ui-prefs/patch";

/** 월별 추이 보기 · 분석 축 · 강사별 퇴원율 정렬·표/차트 저장 — 누르는 순간([[#90]]). 본인 표시 취향이라 로그인만 본다. 기본값이면 키를 지운다. */
export async function saveWithdrawalTrendPrefs(p: {
  showTotal?: boolean; kind?: string; axis?: string; churnSort?: string; churnView?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const patch: Record<string, unknown> = {};
  if (typeof p.showTotal === "boolean") patch.trend_total = p.showTotal ? undefined : "off";
  if (p.kind === "bar" || p.kind === "line") patch.trend_kind = p.kind === "line" ? "line" : undefined;
  if (p.axis === "subject" || p.axis === "teacher" || p.axis === "grade" || p.axis === "school") patch.breakdown_axis = p.axis === "subject" ? undefined : p.axis;
  if (p.churnSort === "recent" || p.churnSort === "name") patch.churn_sort = p.churnSort === "name" ? "name" : undefined;
  if (p.churnView === "table" || p.churnView === "chart") patch.churn_view = p.churnView === "chart" ? "chart" : undefined;
  if (Object.keys(patch).length === 0) return { ok: false, error: "잘못된 값입니다" };
  return patchMyUiPrefs("withdrawals", patch);
}
