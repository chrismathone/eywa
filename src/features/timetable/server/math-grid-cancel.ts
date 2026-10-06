import "server-only";
import { logAction } from "@/features/audit/server/log";
import { logDbError } from "@/lib/supabase/db-error";
import type { createClient } from "@/lib/supabase/server";
import type { GridCreatedClass } from "@/features/timetable/import/math-grid/apply-plan";

type Db = Awaited<ReturnType<typeof createClient>>;

/** 지우지 못한 반 — `enrolled` = 수강이 붙어 있다 · `linked` = 다른 기록(보강 등)이 그 반을 가리켜 DB가 막았다. */
export type KeptGridClass = { name: string; why: "enrolled" | "linked" };

/**
 * 예약 취소 — 이 가져오기가 만든 반을 지운다. 못 지운 반과 그 까닭을 돌려준다.
 * 🔴 수강이 하나라도 붙어 있으면 지우지 않는다 — 그 사이 누가 학생을 넣었으면 그 반은 이미 쓰이고 있다.
 *    (수강 되돌리기가 끝난 **뒤에** 부를 것 — 이 가져오기가 넣은 수강이 남아 있으면 반이 안 지워진다.)
 * ⚠️ 반을 지우면 그 반에 붙인 설정(수업 시간·교재 배정·반 시트·월 목표 등)도 함께 지워진다 — 아직 시작 전인 반이고
 *    예약 취소는 "아무것도 안 한 것처럼"이 약속이다. 지우는 것을 DB가 막는 기록(보강 건 등)이 있으면 남기고 알린다.
 */
export async function removeGridCreatedClasses(supabase: Db, classes: GridCreatedClass[]): Promise<KeptGridClass[]> {
  const left: KeptGridClass[] = [];
  for (const c of classes) {
    const { count, error: countErr } = await supabase
      .from("enrollments")
      .select("*", { count: "exact", head: true })
      .eq("class_id", c.classId);
    if (countErr || (count ?? 0) > 0) {
      left.push({ name: c.name, why: "enrolled" });
      continue;
    }
    const { error } = await supabase.from("classes").delete().eq("id", c.classId);
    if (error) {
      logDbError(error, "timetable.mathGrid.cancelClass");
      left.push({ name: c.name, why: "linked" });
    }
  }
  return left;
}

/** 반을 지운 예약 취소는 기록한다(누가 언제 어떤 반을 없앴는지 — 반 삭제는 되돌릴 수 없다). */
export function logGridCancel(
  effectiveDate: string,
  snapshotIds: string[],
  /** 지우려고 한 반(되돌린 스냅샷의 것만) — 여기서 `kept`를 뺀 것이 실제로 지운 반이다. */
  classes: GridCreatedClass[],
  kept: KeptGridClass[],
  extra: Record<string, unknown>,
): Promise<void> {
  return logAction({
    action: "timetable_import_cancel",
    targetType: "timetable",
    targetLabel: `${effectiveDate} 적용 예정 취소`,
    metadata: {
      effectiveDate,
      snapshotIds,
      removedClasses: classes.map((c) => c.name).filter((name) => !kept.some((k) => k.name === name)),
      keptClasses: kept.map((k) => k.name),
      ...extra,
    },
  });
}

/** 지우지 못한 반 안내 — 까닭별로 한 문장씩. */
export function keptClassesText(kept: KeptGridClass[]): string {
  const names = (why: KeptGridClass["why"]) => kept.filter((k) => k.why === why).map((k) => k.name).join(", ");
  const parts = [
    names("enrolled") ? `새로 만든 반(${names("enrolled")})은 수강이 붙어 있어 지우지 않았습니다` : "",
    names("linked") ? `새로 만든 반(${names("linked")})은 다른 기록이 연결되어 있어 지우지 못했습니다` : "",
  ].filter(Boolean);
  return `${parts.join(" · ")} — 수업목록에서 확인해 주세요.`;
}
