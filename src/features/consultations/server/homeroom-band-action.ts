"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { effectiveTeacherId } from "@/lib/auth/view-mode";
import { getTenantSettings } from "@/features/owner/server/queries";
import { buildSubjectMaps } from "@/features/owner/subjects";
import { homeroomTrendRows, type HomeroomTrendRow } from "../stats-recent";
import { getHomeroomConsultStats } from "./homeroom";

export type HomeroomBandData = { months: string[]; rows: (HomeroomTrendRow & { subjectText: string })[]; teacherScoped: boolean };

/**
 * 상담 목록 요약 띠의 **담임 상담** 칸 재료(stats-summary.tsx · homeroom-band.tsx).
 * 서버 렌더에서 부르지 않고 브라우저가 한 번 불러 몇 분 기억한다 — 담임 현황은 무거운 조회인데 목록은 필터·쪽·창 크기
 * (auto-page-size의 router.replace)마다 다시 그려진다(리뷰 2026-10-30). 강사는 본인 줄만(getHomeroomConsultStats가 거른다).
 */
export async function loadHomeroomBand(): Promise<HomeroomBandData | null> {
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return null;
  if ((await accessLevelTenant(user.systemRole, "consultations")) === "none") return null;
  try {
    const [data, settings, teacherId] = await Promise.all([getHomeroomConsultStats(), getTenantSettings(), effectiveTeacherId()]);
    const subjects = buildSubjectMaps(settings.operations.subjects);
    const { months, rows } = homeroomTrendRows(data);
    return { months, rows: rows.map((r) => ({ ...r, subjectText: r.subjects.map(subjects.labelOf).join("·") })), teacherScoped: !!teacherId };
  } catch (e) {
    console.error("[consultations] 요약 띠 담임 현황 조회 실패:", e instanceof Error ? e.message : String(e));
    return null;
  }
}
