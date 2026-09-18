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

/** 교시 하나의 재료 — 시작시각 + 그 교시에 걸린 반들. */
export type SeatPlanPeriod = { start: string; classIds: readonly string[] };

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
  const byStart = await loadSeatJjPlansForPeriods(seat, [{ start: slotStart, classIds }], tenantId, date);
  return byStart[slotStart] ?? {};
}

/**
 * **'전체' 보기**(JJ실, 원장 2026-09-18 *"펼치기"*) — 그날 모든 교시의 수업계획을 **한 번에** 붙인다.
 *
 * 🔑 왕복은 교시 수와 무관하다(B6): 게이트는 **반마다 한 번**(같은 반이 하루 두 교시여도 한 번), 줄 조회는
 *    하루치 한 번(`plan_date`로 읽고 교시는 JS에서 나눈다 — 교시 하나 보기도 원래 그렇게 읽었다).
 * 🔴 게이트는 교시 하나 보기와 **같은 함수**다 — 보기를 바꿨다고 계획이 더 보이거나 덜 보이면 안 된다.
 * 🔴 돌려주는 키는 **호출부의 교시 시작시각 그대로**다(화면이 명단과 짝을 찾는 키).
 */
export async function loadSeatJjPlansForPeriods(
  seat: SeatKey,
  periods: readonly SeatPlanPeriod[],
  tenantId: string,
  date: string,
): Promise<Record<string, Record<string, SeatClassPlan>>> {
  if (!seatHasJjFields(seat) || periods.length === 0) return {};
  const unique = [...new Set(periods.flatMap((p) => p.classIds))];
  if (unique.length === 0) return {};

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
  const allowed = new Map(
    gates.filter((g): g is NonNullable<typeof g> => g !== null).map((g) => [g.classId, g.access]),
  );
  if (allowed.size === 0) return {};

  // 로그 한 줄에 적을 교시 — 하나면 그 교시, 여럿이면 '전체'.
  const scopeSlot = periods.length === 1 ? hhmm(periods[0]!.start) : "all";
  const lines = await fetchSeatPlanLinesOfDay(tenantId, [...allowed.keys()], date, scopeSlot);
  if (!lines) return {};

  const out: Record<string, Record<string, SeatClassPlan>> = {};
  for (const period of periods) {
    const slot = hhmm(period.start);
    const byClass: Record<string, SeatClassPlan> = {};
    for (const classId of new Set(period.classIds)) {
      const access = allowed.get(classId);
      if (!access) continue;
      byClass[classId] = {
        classId,
        canEdit: access.canWrite,
        showExamTerm: access.englishTrack !== "eie",
        skillAreas: access.skillAreas,
        lines: lines.get(planLinesKey(slot, classId)) ?? [],
      };
    }
    out[period.start] = byClass;
  }
  return out;
}

function planLinesKey(slot: string, classId: string): string {
  return `${slot}|${classId}`;
}

/**
 * 그 날의 계획 줄 전부를 `교시|반` 키로 — **게이트는 호출부가 이미 통과시킨 뒤**다.
 * 🔴 `class_sheet_*`는 RLS 정책이 0개라 세션 클라이언트로는 **에러 없이 0행**([[#104]]) →
 *    admin + `tenant_id` 명시 필터.
 * ⚠️ 실패는 **null**(예외 아님) — 조회가 깨져도 출결 화면은 살아야 한다([[#95]]).
 */
async function fetchSeatPlanLinesOfDay(
  tenantId: string,
  classIds: readonly string[],
  date: string,
  scopeSlot: string,
): Promise<Map<string, PlanLineDTO[]> | null> {
  const unique = [...new Set(classIds)];
  if (unique.length === 0) return new Map();
  let rows: Record<string, unknown>[];
  try {
    const admin = createAdminClient();
    rows = await fetchInChunks<Record<string, unknown>>(unique, (chunk) =>
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
    reportError(e, { scope: "attendance.seat.jj-plan", tenantId, date, slot: scopeSlot });
    return null;
  }
  const byKey = new Map<string, PlanLineDTO[]>();
  for (const row of rows) {
    // 교시는 JS에서 나눈다 — DB는 time("HH:MM:SS")이라 문자열 eq가 표기 차이에 걸린다.
    const key = planLinesKey(hhmm(row.slot_start as string), row.class_id as string);
    (byKey.get(key) ?? byKey.set(key, []).get(key)!).push(planLineFromRow(row));
  }
  return byKey;
}

/**
 * 그 날·그 교시의 계획 줄을 반별로 읽어 온다 — **게이트는 호출부가 이미 통과시킨 뒤**다.
 *
 * 🔑 문이 둘(로그인 ECS 게이트 / 공개 자리 PIN 명단)이라 조회를 두 벌로 적지 않는다. 두 벌이면 한쪽만
 *    교시 표기(`hhmm`)나 정렬을 고쳤을 때 같은 반이 화면마다 다른 줄을 보여준다 — 로그인 쪽 하루치 조회
 *    (`fetchSeatPlanLinesOfDay`)도 같은 함수다.
 * ⚠️ 실패는 **null**(예외 아님) — 조회가 깨져도 출결 화면은 살아야 한다([[#95]]).
 */
export async function fetchSeatSlotPlanLines(
  tenantId: string,
  classIds: readonly string[],
  date: string,
  slotStart: string,
): Promise<Map<string, PlanLineDTO[]> | null> {
  const slot = hhmm(slotStart);
  const all = await fetchSeatPlanLinesOfDay(tenantId, classIds, date, slot);
  if (!all) return null;
  const byClass = new Map<string, PlanLineDTO[]>();
  for (const classId of new Set(classIds)) {
    const lines = all.get(planLinesKey(slot, classId));
    if (lines) byClass.set(classId, lines);
  }
  return byClass;
}
