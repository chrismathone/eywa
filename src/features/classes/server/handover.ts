import "server-only";
import { kstToday } from "@/lib/date-kst";
import type { createClient } from "@/lib/supabase/server";
import { dayBefore } from "../schedule-preserve";
import { explainDbError } from "@/lib/supabase/db-error";

type Sb = Awaited<ReturnType<typeof createClient>>;

/** `.in()`에 수십~수백 id를 한 번에 넣으면 URL이 414로 죽는다(B3) — 항상 청크로 나눠 쓴다. */
const CHUNK = 50;
const chunks = <T>(xs: T[]): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += CHUNK) out.push(xs.slice(i, i + CHUNK));
  return out;
};

export type MoveResult = { moved: number; error?: string };

/**
 * 담임 교체가 놓치던 **두 번째 표면** — 교시별 강사 오버라이드(`class_schedules.teacher_id`).
 *
 * `classes.teacher_id`만 바꾸면 시간표는 옛 강사를 계속 보여준다: 슬롯의 teacher_id는 "이 교시는
 * 이 사람이"라는 **셀 단위 오버라이드**라 반 기본값을 상속하지 않는다(실측 2026-08-03 injaewon —
 * 활성 반 슬롯 868개 중 247개가 오버라이드, 그중 다수가 담임과 다른 사람). 게다가 이 컬럼은 ECS
 * 부담임 접근 스코프의 **유일한 근거**(`ecsAssistantClassIds`)라, 남겨두면 떠난 강사만 시트를 열 수
 * 있고 새 담임은 못 여는 상태가 된다.
 *
 * ⚠️ **만료 슬롯은 건드리지 않는다.** class_schedules는 운영 이력을 함께 담아(gotcha #88) 지난
 *    교시는 "그때 실제로 누가 가르쳤나"의 기록이다 — 인계는 오늘 이후 배치만 바꾼다.
 * ⚠️ `slot_teacher_label`(시트 원문 표기 "LAB"·"JJ"·영문 닉네임)은 **UPDATE 금지** — 표시 전용이고
 *    teacher_id와 의미가 다르다(라벨만 있는 당번 자리는 teacher_id가 애초에 null).
 */
export async function moveLiveSlotTeacher(
  supabase: Sb,
  args: { tenantId: string; classIds: string[]; fromTeacherId: string; toTeacherId: string },
): Promise<MoveResult> {
  const { tenantId, classIds, fromTeacherId, toTeacherId } = args;
  if (classIds.length === 0) return { moved: 0 };
  const today = kstToday();
  const yesterday = dayBefore(today);
  let moved = 0;
  for (const part of chunks(classIds)) {
    // 🔴 **덮어쓰지 않고 쪼갠다**(원장 2026-08-04 "주차변경시에 실제로 일어났던 모든것이 반영되도록").
    // 옛 담당으로 돌던 구간을 어제까지로 마감한 사본을 남기고, 원래 행은 오늘부터 새 담당으로 만든다.
    // 그래야 지난 주 시간표에 그때의 담당이 그대로 남는다(예전엔 같은 행을 덮어써서 과거까지 바뀌었다).
    const { data: targets, error: readErr } = await supabase
      .from("class_schedules")
      .select(
        "id, class_id, day_of_week, start_time, end_time, valid_from, valid_to, teacher_id, classroom_id, slot_teacher_label, slot_room_label, period_label, merge_group",
      )
      .eq("tenant_id", tenantId)
      .in("class_id", part)
      .eq("teacher_id", fromTeacherId)
      .or(`valid_to.is.null,valid_to.gte.${today}`);
    if (readErr) return { moved, error: explainDbError(readErr, { scope: "classes.handover.moveLiveSlotTeacher", fallback: "확인하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    if (!targets || targets.length === 0) continue;

    // 오늘 시작한 행은 쪼갤 과거가 없다(마감일이 시작일보다 빨라지는 거꾸로 된 구간 방지).
    const splittable = targets.filter((t) => !t.valid_from || String(t.valid_from).slice(0, 10) < today);
    if (splittable.length > 0) {
      const archives = splittable.map((t) => ({
        tenant_id: tenantId,
        class_id: t.class_id,
        day_of_week: t.day_of_week,
        start_time: t.start_time,
        end_time: t.end_time,
        valid_from: t.valid_from,
        valid_to: yesterday,
        teacher_id: t.teacher_id,
        classroom_id: t.classroom_id,
        slot_teacher_label: t.slot_teacher_label,
        slot_room_label: t.slot_room_label,
        period_label: t.period_label,
        merge_group: t.merge_group,
      }));
      const { error: archErr } = await supabase.from("class_schedules").insert(archives);
      // 마감 사본을 못 남기면 **이력이 조용히 사라진 채 담당만 바뀐다** → 여기서 멈춘다.
      if (archErr) return { moved, error: explainDbError(archErr, { scope: "classes.handover.moveLiveSlotTeacher", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    }
    const splitIds = new Set(splittable.map((t) => t.id as string));
    // 쪼갠 행은 오늘부터, 오늘 만든 행은 시작일 그대로.
    const { data, error } = await supabase
      .from("class_schedules")
      .update({ teacher_id: toTeacherId, valid_from: today })
      .in("id", [...splitIds])
      .select("id");
    if (error) return { moved, error: explainDbError(error, { scope: "classes.handover.moveLiveSlotTeacher", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    moved += data?.length ?? 0;
    const rest = targets.filter((t) => !splitIds.has(t.id as string)).map((t) => t.id as string);
    if (rest.length > 0) {
      const { data: d2, error: e2 } = await supabase
        .from("class_schedules")
        .update({ teacher_id: toTeacherId })
        .in("id", rest)
        .select("id");
      if (e2) return { moved, error: e2.message };
      moved += d2?.length ?? 0;
    }
  }
  return { moved };
}

/**
 * 담임(`classes.teacher_id`) 일괄 교체 — 남아 있던 인수인계 예약(pending_teacher_*)도 함께 비운다.
 *
 * `.eq("teacher_id", fromTeacherId)`가 **레이스 가드**다: 화면 목록이 stale해 이미 다른 사람에게
 * 넘어간 반이 섞여 들어와도 그 반은 조용히 건너뛴다(남의 배정을 덮어쓰지 않는다). 그래서 반환값
 * `moved`는 "요청한 개수"가 아니라 **실제로 바뀐 개수** — 호출부는 이 값을 사용자에게 보여줄 것.
 */
export async function reassignHomeroom(
  supabase: Sb,
  args: { tenantId: string; classIds: string[]; fromTeacherId: string; toTeacherId: string },
): Promise<MoveResult> {
  const { tenantId, classIds, fromTeacherId, toTeacherId } = args;
  if (classIds.length === 0) return { moved: 0 };
  let moved = 0;
  for (const part of chunks(classIds)) {
    const { data, error } = await supabase
      .from("classes")
      .update({
        teacher_id: toTeacherId,
        pending_teacher_id: null,
        pending_teacher_date: null,
        pending_teacher_reason: null,
      })
      .eq("tenant_id", tenantId)
      .in("id", part)
      .eq("teacher_id", fromTeacherId)
      .select("id");
    if (error) return { moved, error: explainDbError(error, { scope: "classes.handover.reassignHomeroom", fallback: "저장하지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message };
    moved += data?.length ?? 0;
  }
  return { moved };
}
