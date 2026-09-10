import "server-only";

/**
 * 비로그인 공개 자리 화면(`/seat/jj`)의 **진도(수업계획)** 조회·쓰기 게이트.
 *
 * 원장 2026-08-25: *"쓰기까지 열자"* — 로그인 화면(`/attendance/seat/jj`)에 붙인 진도를 PIN 화면에도
 * 그대로 연다. 기록·표·저장 경로는 **한 벌 그대로**이고 여기서 바뀌는 건 **문(게이트)뿐**이다.
 *
 * 🔴 문이 좁다 — 이 화면엔 로그인이 없다. 통과 조건은 셋뿐이고 하나라도 빠지면 **키 자체가 없다**
 *    (구획이 안 생기고, 강제 호출도 거절된다):
 *      ① 그 자리 PIN 쿠키가 유효할 것([`gateSeatPinOnly`](./gate.ts) — 로그인 상태를 아예 안 본다)
 *      ② 날짜 = **오늘**(같은 함수가 판정)
 *      ③ 반이 **그날 그 자리 그 교시 명단**에 있을 것([`rosterKeys`](./gate.ts) — 출결 쓰기가 쓰는 그 명단)
 *    ④ 덤으로 그 반이 영어 시트 대상(과목 english + 구분 영역 있음)일 것 — 아니면 계획 자체가 없는 반이다.
 *
 * 🔴 **명단 판정을 두 벌로 만들지 말 것.** 여기서 반 목록을 다시 조회하지 않고 `rosterKeys`가 돌려준
 *    것만 쓴다(모호 슬롯 제외 규칙까지 따라온다 — 그래야 화면에 그린 구획이 저장도 된다).
 * 🔴 랩실(LAB)은 대상이 아니다(`seatHasJjFields`) — 그 화면엔 진도 재료를 아예 안 만든다.
 * 🔵 작성자는 **null** — 로그인 없이 적은 것을 누군가의 이름으로 적지 않는다(출결 `recorded_by`·JJ 칸
 *    `updated_by`가 PIN일 때 null인 것과 같은 정직함).
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchInChunks } from "@/lib/supabase/batch";
import { reportError } from "@/lib/observability/report-error";
import { readEnglishTrack } from "@/features/classes/english-track";
import { getTenantSettingsByTenantId } from "@/features/owner/server/queries";
import { resolveSkillAreas } from "@/features/owner/skill-areas";
import type { SkillAreaSetting } from "@/features/owner/settings-types";
import type { PlanWriteGrant, PlanWriteScope } from "@/features/class-sheets/server/plan-write";
import { seatHasJjFields } from "../jj-fields";
import { hhmm, type SeatKey } from "../seat";
import { gateSeatPinOnly, rosterKeys } from "./gate";
import { fetchSeatSlotPlanLines, type SeatClassPlan } from "./jj-plan";

/** 그 반이 영어 시트(ECS) 대상인가 + 계획 표를 그리는 데 필요한 메타. 대상이 아니면 목록에 없다. */
export type PublicPlanClassMeta = {
  /** '내신' 구획을 그릴지 — EiE 반은 초등이라 내신이 없다(시트와 같은 판정: `english_track` 컬럼). */
  showExamTerm: boolean;
  skillAreas: SkillAreaSetting[];
};

/**
 * 반 → 계획 메타. **ECS 진입 조건은 로그인 게이트와 같은 두 줄**(과목 english + `resolveSkillAreas` 비어있지
 * 않음, `requireEcsClassAccess` §④). 조건이 갈리면 영어 시트에선 없는 구분이 자리 화면에만 뜬다.
 *
 * 🔴 세션이 없어 admin으로 읽는다 → `tenant_id` 명시 필터 필수(RLS 우회).
 * ⚠️ 실패는 **빈 Map**(예외 아님) — 조회가 깨져도 출결 화면은 살아야 한다([[#95]]).
 */
export async function resolvePublicPlanClasses(
  tenantId: string,
  classIds: readonly string[],
): Promise<Map<string, PublicPlanClassMeta>> {
  const unique = [...new Set(classIds)];
  const out = new Map<string, PublicPlanClassMeta>();
  if (unique.length === 0) return out;
  try {
    const admin = createAdminClient();
    // 반 메타와 학원설정은 서로 독립이라 병렬(B4). id가 수십 개까지 갈 수 있어 청크(B3).
    const [rows, settings] = await Promise.all([
      fetchInChunks<{ id: string; subject: string | null; english_track: string | null }>(
        unique,
        (chunk) =>
          admin
            .from("classes")
            .select("id, subject, english_track")
            .eq("tenant_id", tenantId)
            .in("id", chunk),
      ),
      getTenantSettingsByTenantId(tenantId),
    ]);
    for (const row of rows) {
      const subjectRow = settings.operations.subjects.find((s) => s.key === row.subject);
      const skillAreas = resolveSkillAreas(subjectRow);
      if (row.subject !== "english" || skillAreas.length === 0) continue;
      out.set(row.id, { showExamTerm: readEnglishTrack(row) !== "eie", skillAreas });
    }
  } catch (e) {
    reportError(e, { scope: "attendance.seat.jj-plan-public.classes", tenantId });
    return new Map();
  }
  return out;
}

/**
 * 공개 PIN 화면에 그릴 그 교시 계획 — 반 id → 계획. **명단 밖 반은 키가 없다.**
 *
 * 로그인 쪽 [`loadSeatJjPlans`](./jj-plan.ts)와 **모양이 같은 값**을 돌려준다(같은 `SlotPlanBlock`이
 * 그린다). 다른 점은 반을 고르는 근거뿐: 저쪽은 ECS 게이트, 여기는 PIN + 그날 그 교시 명단.
 */
export async function loadPublicSeatJjPlans(
  seat: SeatKey,
  tenantId: string,
  date: string,
  slotStart: string,
): Promise<Record<string, SeatClassPlan>> {
  if (!seatHasJjFields(seat)) return {};
  const gate = await gateSeatPinOnly(seat, date);
  if ("error" in gate || gate.tenantId !== tenantId) return {};

  const slot = hhmm(slotStart);
  const roster = await rosterKeys(seat, date, slot, tenantId, tenantId);
  if (!roster) return {};
  const classIds = [...roster.classes.keys()];
  if (classIds.length === 0) return {};

  const [metas, linesByClass] = await Promise.all([
    resolvePublicPlanClasses(tenantId, classIds),
    fetchSeatSlotPlanLines(tenantId, classIds, date, slot),
  ]);
  if (!linesByClass || metas.size === 0) return {};

  const out: Record<string, SeatClassPlan> = {};
  for (const classId of classIds) {
    const meta = metas.get(classId);
    if (!meta) continue;
    out[classId] = {
      classId,
      // PIN을 넣고 들어온 사람은 그 자리 오늘 기록을 적는 사람이다 — 읽기만 하는 갈래가 없다.
      canEdit: true,
      showExamTerm: meta.showExamTerm,
      skillAreas: meta.skillAreas,
      lines: linesByClass.get(classId) ?? [],
    };
  }
  return out;
}

/**
 * 공개 PIN 진도 **쓰기 게이트** — 통과하면 계획 쓰기 밑바닥에 넘길 허가증 + **범위**를 돌려준다.
 *
 * 🔴 화면 조건은 게이트가 아니다(#77) — 모든 쓰기 액션이 **매번** 이 함수를 지난다. 위 조회와 같은
 *    네 조건을 그대로 다시 본다(PIN·오늘·명단·ECS 대상 반).
 * 🔴 **`scope`를 꼭 함께 넘길 것.** 줄 id는 반에만 묶여 있어서, 범위를 안 주면 "오늘만"으로 통과한 사람이
 *    그 반의 **지난 날짜 줄**을 (id만 알면) 고치거나 지울 수 있다 — 게이트가 거짓말이 된다.
 *    돌려주는 `scope`는 **게이트가 실제로 본 값**(정규화된 교시)이라, 호출부가 입력을 다시 쓰지 않으면
 *    게이트와 쓰기가 갈릴 수 없다.
 */
export async function gateSeatPlanWrite(input: {
  seat: SeatKey;
  date: string;
  slotStart: string;
  classId: string;
}): Promise<{ ok: true; grant: PlanWriteGrant; scope: PlanWriteScope } | { ok: false; error: string }> {
  if (!seatHasJjFields(input.seat)) return { ok: false, error: "이 자리에는 수업계획 칸이 없습니다" };
  const gate = await gateSeatPinOnly(input.seat, input.date);
  if ("error" in gate) return { ok: false, error: gate.error };

  const slot = hhmm(input.slotStart);
  const roster = await rosterKeys(input.seat, input.date, slot, gate.tenantId, gate.tenantId);
  if (!roster) return { ok: false, error: "그 시각에는 이 자리 수업이 없습니다" };
  if (!roster.classes.has(input.classId)) return { ok: false, error: "이 교시에 없는 반입니다" };

  const metas = await resolvePublicPlanClasses(gate.tenantId, [input.classId]);
  if (!metas.has(input.classId)) return { ok: false, error: "이 반은 수업계획 대상이 아닙니다" };

  // 작성자 = null. 이 문으로 들어온 사람은 계정이 없다(있어도 이 문은 계정을 안 본다).
  return {
    ok: true,
    grant: { tenantId: gate.tenantId, classId: input.classId, actorId: null },
    scope: { planDate: input.date, slotStart: slot },
  };
}
