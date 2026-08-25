import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { requireEcsClassAccess } from "@/features/class-sheets/server/access";
import { planLineFromRow } from "@/features/class-sheets/lib/plan-line";
import type { PlanLineDTO } from "@/features/class-sheets/server/actions";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import { seatHasJjFields } from "../jj-fields";
import { hhmm, type SeatKey } from "../seat";

export type SeatClassPlan = {
  classId: string;
  /** 계획 줄을 고칠 수 있나 — **영어 시트와 같은 게이트**(`requireEcsClassAccess`)가 정한다. */
  canEdit: boolean;
  /** '내신' 구획을 그릴지(EiE 반은 초등이라 내신이 없다) — 판정은 `classes.english_track` 컬럼뿐. */
  showExamTerm: boolean;
  skillAreas: SkillAreaSetting[];
  lines: PlanLineDTO[];
};

/**
 * 자리(JJ실) 출석부에 **그 교시 수업계획**을 붙인다 — 영어 강사 시트의 JJ 교시 카드와 같은 기록.
 *
 * 🔴 **권한은 자리 게이트가 아니라 ECS 게이트가 정한다.** 자리 화면은 아르바이트·viewer도 여는 화면이라
 *    "출결을 찍을 수 있다"가 "계획을 볼/쓸 수 있다"를 뜻하지 않는다. 반마다 `requireEcsClassAccess`를
 *    통과한 것만 돌려주고, 통과 못 한 반은 **아예 키가 없다**(화면에 계획 구획 자체가 안 생긴다).
 *    쓰기 게이트도 같은 함수의 `canWrite` — 서버 액션이 그 게이트를 다시 본다(#77).
 * 🔴 랩실(LAB)은 대상이 아니다 — `seatHasJjFields`가 false면 즉시 빈 값(공개 PIN 화면도 이 함수를 안 부른다).
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 세션 클라이언트로 읽으면 **에러 없이 0행**([[#104]]) →
 *    admin + `tenant_id` 명시 필터.
 * ⚠️ 조회가 깨져도 **출결 화면은 살아야 한다**([[#95]]) — 실패는 로그만 남기고 계획 없이 그린다.
 */
export async function loadSeatJjPlans(
  seat: SeatKey,
  classIds: readonly string[],
  tenantId: string,
  date: string,
  slotStart: string,
): Promise<Record<string, SeatClassPlan>> {
  if (!seatHasJjFields(seat) || classIds.length === 0) return {};
  const slot = hhmm(slotStart);
  const unique = [...new Set(classIds)];

  // 반마다 독립인 게이트라 병렬(B4). 거절된 반은 그냥 빠진다(에러 아님 — 계획을 못 보는 게 정상인 사람).
  const gates = await Promise.all(
    unique.map(async (classId) => {
      try {
        const gate = await requireEcsClassAccess(classId);
        return gate.ok ? { classId, access: gate.access } : null;
      } catch (e) {
        reportError(e, { scope: "attendance.seat.jj-plan.gate", tenantId, classId });
        return null;
      }
    }),
  );
  const allowed = gates.filter((g): g is NonNullable<typeof g> => g !== null);
  if (allowed.length === 0) return {};

  let rows: Record<string, unknown>[];
  try {
    const admin = createAdminClient();
    rows = await fetchInChunks<Record<string, unknown>>(
      allowed.map((g) => g.classId),
      (chunk) =>
        admin
          .from("class_sheet_plan_lines")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("plan_date", date)
          .in("class_id", chunk)
          .order("term_mode")
          .order("line_no"),
    );
  } catch (e) {
    reportError(e, { scope: "attendance.seat.jj-plan", tenantId, date, slot });
    return {};
  }

  const linesByClass = new Map<string, PlanLineDTO[]>();
  for (const row of rows) {
    // 교시는 JS에서 거른다 — DB는 time("HH:MM:SS")이라 문자열 eq가 표기 차이에 걸린다.
    if (hhmm(row.slot_start as string) !== slot) continue;
    const classId = row.class_id as string;
    (linesByClass.get(classId) ?? linesByClass.set(classId, []).get(classId)!).push(planLineFromRow(row));
  }

  const out: Record<string, SeatClassPlan> = {};
  for (const { classId, access } of allowed) {
    out[classId] = {
      classId,
      canEdit: access.canWrite,
      showExamTerm: access.englishTrack !== "eie",
      skillAreas: access.skillAreas,
      lines: linesByClass.get(classId) ?? [],
    };
  }
  return out;
}
