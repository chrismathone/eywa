import "server-only";
import { kstToday } from "@/lib/date-kst";
import type { createClient } from "@/lib/supabase/server";

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
  let moved = 0;
  for (const part of chunks(classIds)) {
    const { data, error } = await supabase
      .from("class_schedules")
      .update({ teacher_id: toTeacherId })
      .eq("tenant_id", tenantId)
      .in("class_id", part)
      .eq("teacher_id", fromTeacherId)
      .or(`valid_to.is.null,valid_to.gte.${today}`)
      .select("id");
    if (error) return { moved, error: error.message };
    moved += data?.length ?? 0;
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
    if (error) return { moved, error: error.message };
    moved += data?.length ?? 0;
  }
  return { moved };
}
