import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { featureLive } from "@/features/makeups/types";
import { getTenantSettings } from "@/features/owner/server/queries";

// 문구는 일반 모듈에 — 원스크린 일괄 발송(클라이언트)이 같은 문구로 거절 사유를 가른다.
export { MAKEUP_CHECK_REQUIRED_ERROR } from "../makeup-check-error";

/**
 * 보고서 발송의 **보강 진행 여부 확인** 게이트(원장 2026-10-27 *"보강체크를 하지 않으면 보고서 발송 비활성화"*) — 서버 겹.
 * 이 보고서에 든 보강 예약 중 확인 전(`checked_at` null, 0458a)인 것이 있나:
 *  · 정규 줄(`classId`) = 그 반 그날의 **합침** 예약(report_mode null·merge) — 분리 예약은 따로 선 보강 줄의 몫.
 *  · 보강 줄 = 앵커 반(`makeupClassId`)의 그날 예약 전부.
 * 화면 `needsMakeupCheck`(onescreen/reserved-makeup.ts)와 같은 축. 확인 칸이 없거나 조회가 실패하면 **막지 않는다**(fail-open) —
 * 시수·출결 안전장치가 아니라 확인 절차라, 조회가 흔들릴 때 보강 보고서 발송 전체를 죽이지 않는다(화면 게이트가 한 겹 더 있다).
 * 강사 RLS에 가리지 않게 admin + 명시 tenant_id(#104).
 * 🔴 보강관리(신규)가 켜진 지점(on·draining)은 막지 않는다 — 연결 예약은 확인을 쓸 수 없다(원스크린 명단도 확인 칸을 안 읽는다,
 *    makeup-reservation-queries.ts `getRosterReservationsOn`).
 * ⚠️ `"use server"` 파일에 두지 말 것 — 내보내면 브라우저가 부를 수 있는 액션이 된다(지점 id를 인자로 받는다).
 */
export async function makeupCheckPending(at: {
  tenantId: string;
  studentId: string;
  date: string;
  classId: string | null;
  makeupClassId: string | null;
}): Promise<boolean> {
  const cls = at.classId ?? at.makeupClassId;
  if (!at.tenantId || !at.studentId || !cls) return false;
  try {
    if (featureLive((await getTenantSettings()).makeups.mode)) return false;
    let q = createAdminClient()
      .from("makeup_reservations")
      .select("id")
      .eq("tenant_id", at.tenantId)
      .eq("student_id", at.studentId)
      .eq("class_id", cls)
      .eq("makeup_date", at.date)
      .in("status", ["reserved", "done"])
      .is("checked_at", null);
    if (at.classId) q = q.or("report_mode.is.null,report_mode.eq.merge");
    const { data, error } = await q.limit(1);
    if (error) {
      // 칸 미적용(0458a·0438a)은 조용히 — 매 발송마다 로그가 쌓이지 않게.
      if (!/checked_at|report_mode|makeup_reservations/.test(error.message ?? "")) console.error("[makeup-check] 확인 조회 실패", error.message);
      return false;
    }
    return (data ?? []).length > 0;
  } catch {
    return false;
  }
}

/**
 * 관리자 일괄 발송·재발송(원스크린을 거치지 않는 길 — 적대 리뷰 2026-10-27)의 같은 게이트 — 확인 전 보강 행의 id.
 * 보강이 든 행(`makeup`)만 묻는다(대부분 0건이라 왕복이 거의 없다).
 */
export async function makeupUncheckedIds(
  tenantId: string,
  rows: readonly { id: unknown; student_id: unknown; report_date: unknown; class_id: unknown; makeup_class_id?: unknown; makeup: unknown }[],
): Promise<Set<string>> {
  const out = new Set<string>();
  for (const r of rows) {
    if (!r.makeup) continue;
    const pending = await makeupCheckPending({
      tenantId,
      studentId: String(r.student_id ?? ""),
      date: String(r.report_date ?? "").slice(0, 10),
      classId: (r.class_id as string | null) ?? null,
      makeupClassId: (r.makeup_class_id as string | null | undefined) ?? null,
    });
    if (pending) out.add(String(r.id));
  }
  return out;
}
