import "server-only";
import type { SystemRole } from "@/lib/permissions";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { isFeatureOptedIn } from "@/lib/license/server";
import { REPORT_RATING_VISIBLE } from "../report-rating";

/**
 * 수업보고서 평점을 서버에서 읽어 화면에 실을 수 있는가 — 목록 · 정렬 · 업무 완성도가 함께 쓰는 단일 문.
 * 지점 스위치는 기본 꺼짐이고 조회 실패도 꺼짐(`isFeatureOptedIn` 규칙)이다.
 */
export async function canViewReportRatings(tenantId: string, role: SystemRole): Promise<boolean> {
  if (!REPORT_RATING_VISIBLE) return false;
  const [optedIn, canWrite] = await Promise.all([
    isFeatureOptedIn(tenantId, "report_rating"),
    canWriteTenant(role, "lesson_reports"),
  ]);
  return optedIn && canWrite;
}
