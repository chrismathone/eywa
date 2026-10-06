import "server-only";
import { revalidatePath } from "next/cache";
import { logAction } from "@/features/audit/server/log";
import { explainDbError } from "@/lib/supabase/db-error";
import type { createClient } from "@/lib/supabase/server";
import { createGridClasses } from "./math-grid-create";
import type {
  GridApplyPlan,
  GridApplyState,
  GridCreatedClass,
  PlanTarget,
} from "@/features/timetable/import/math-grid/apply-plan";

type Db = Awaited<ReturnType<typeof createClient>>;

/**
 * 서버가 다시 세우고 해시로 검증한 계획을 실제로 쓴다(내부 전용 — 화면이 보낸 계획은 받지 않는다. 시트 잠금은 호출부가 쥔다).
 *
 * 순서: ① 반 + 수업 시간 만들기 → ② 스냅샷 → ③ 이동 → ④ 종료 → ⑤ 추가 → ⑥ 스냅샷에 새 수강 id 적기 → ⑦ 이력·감사로그.
 *  · ①·②가 실패하면 이번에 만든 반을 지우고 멈춘다(**변경 없음**). 스냅샷은 예약 취소의 근거라 없이는 쓰지 않는다.
 *  · `effective` = 적용일. 새 반의 수업 시간은 그날부터 열리고(`valid_from`), 이동은 그날 옛 수강을 닫고 새 수강을 연다.
 *
 * 🔴 스냅샷 payload는 **수강편집 가져오기와 같은 모양**(moves·removes·adds, `kind` 키 없음)이어야 한다 —
 *    예약 취소(`rollback_enrollment_import`, 0236a)가 그 모양을 읽는다. 종료 사유 문구도 그 함수가 대조한다.
 */
export async function executeGridPlan(
  supabase: Db,
  user: { id: string; tenantId: string },
  plan: GridApplyPlan,
  effective: string,
): Promise<GridApplyState> {
  // ① 반 + 수업 시간
  const made = await createGridClasses(supabase, user.tenantId, plan, effective);
  if (!made.ok) return made.state;
  const { created, abort } = made;
  const classIdOf = (to: PlanTarget) => to.classId ?? created.find((c) => c.key === to.key)!.classId;

  // ② 스냅샷 — 되돌릴 근거. 못 남기면 출발하지 않는다.
  const diff = {
    moves: plan.moves.map((m) => ({
      enrollmentId: m.enrollmentId,
      studentName: m.label,
      fromClassName: m.fromName,
      toClassName: m.to.name,
      toClassId: classIdOf(m.to),
      newEnrollmentId: undefined as string | undefined,
    })),
    removes: plan.removes.map((r) => ({ enrollmentId: r.enrollmentId, studentName: r.label, className: r.className })),
    adds: plan.adds.map((a) => ({
      studentName: a.label,
      className: a.to.name,
      classId: classIdOf(a.to),
      studentId: a.studentId,
      enrollmentId: undefined as string | undefined,
    })),
    gridClasses: created.map(({ classId, name, scheduleIds }): GridCreatedClass => ({ classId, name, scheduleIds })),
  };
  const counts = { classes: created.length, moves: diff.moves.length, removes: diff.removes.length, adds: diff.adds.length };
  const { data: snap, error: snapErr } = await supabase
    .from("timetable_snapshots")
    .insert({
      tenant_id: user.tenantId,
      label: "수학 시트 시간표 탭 가져오기",
      reference_date: effective,
      summary: counts,
      payload: diff,
      created_by: user.id,
    })
    .select("id")
    .single();
  if (snapErr || !snap?.id) {
    explainDbError(snapErr, { scope: "timetable.mathGrid.snapshot", fallback: "" });
    return abort("되돌리기용 기록을 저장하지 못해 적용을 중단했습니다.");
  }
  const snapshotId = snap.id as string;

  let failed = 0;
  let heldAdds = 0;
  // 🔴 이력·감사로그에는 **실제로 된 건수**를 적는다 — 계획 건수를 적으면 이동에서 멈춘 적용이 "이동 3건"으로 남는다.
  const done = { moved: 0, removed: 0, added: 0 };
  const finish = async (abortedAt?: string) => {
    await supabase.from("timetable_snapshots").update({ payload: diff }).eq("id", snapshotId);
    // 이력 행은 예약 취소가 '되돌림' 표식을 찍는 자리다 — 없으면 취소한 예약이 배지에 계속 남는다.
    await supabase.from("timetable_import_logs").insert({
      tenant_id: user.tenantId,
      week_label: effective,
      snapshot_id: snapshotId,
      result: { classes: counts.classes, moves: done.moved, removes: done.removed, adds: done.added, heldAdds, failed, ...(abortedAt ? { abortedAt } : {}) },
      details: diff,
      actor_id: user.id,
    });
    await logAction({
      action: "timetable_import_apply",
      targetType: "timetable",
      targetLabel: "구글 시트 시간표 탭",
      metadata: {
        source: "sheet_grid",
        subject: "math",
        effectiveDate: effective,
        createdClasses: created.map((c) => c.name),
        ...done,
        heldAdds,
        failed,
        snapshotId,
        ...(abortedAt ? { abortedAt } : {}),
      },
    });
    revalidatePath("/timetable");
    revalidatePath("/classes");
  };

  // ③ 이동 — 일괄이동 RPC(옛 수강을 적용일에 닫고 새 수강을 연다). 적용일은 항상 명시한다(기본값은 DB 시각).
  if (plan.moves.length > 0) {
    const { data, error } = await supabase.rpc("move_enrollments_batch", {
      p_effective_date: effective,
      p_moves: plan.moves.map((m) => ({
        enrollmentId: m.enrollmentId,
        newClassId: classIdOf(m.to),
        attendanceDays: m.attendanceDays,
      })),
    });
    if (error) {
      explainDbError(error, { scope: "timetable.mathGrid.move", fallback: "" });
      await finish("move");
      return {
        error: `학생 이동을 적용하지 못했습니다${created.length ? `(반 ${created.length}개는 만들어졌습니다)` : ""} — 다시 불러와 적용하면 남은 변경만 적용됩니다.`,
        snapshotId,
      };
    }
    const results = (data ?? []) as { enrollmentId: string; newEnrollmentId?: string; ok: boolean }[];
    done.moved = results.filter((r) => r.ok).length;
    failed += plan.moves.length - done.moved;
    for (const m of diff.moves) {
      const id = results.find((r) => r.ok && r.enrollmentId === m.enrollmentId)?.newEnrollmentId;
      if (id) m.newEnrollmentId = id;
    }
  }

  // ④ 종료 — 사유 문구는 되돌리기 함수(0236a)가 "이 가져오기가 남긴 것인가"를 가리는 표식이다. 바꾸지 말 것.
  for (const r of plan.removes) {
    const { error } = await supabase
      .from("enrollments")
      .update({ end_date: effective, withdrawal_reason: "엑셀 import 삭제" })
      .eq("id", r.enrollmentId);
    if (error) failed += 1;
    else done.removed += 1;
  }

  // ⑤ 추가 — 휴원 학생은 휴원 표식을 달고 들어간다(계획이 학생 상태에서 정했다).
  for (let i = 0; i < plan.adds.length; i++) {
    const a = plan.adds[i]!;
    const { data: made, error } = await supabase
      .from("enrollments")
      .insert({
        tenant_id: user.tenantId,
        student_id: a.studentId,
        class_id: classIdOf(a.to),
        start_date: effective,
        on_hold: a.onHold,
        attendance_days: a.attendanceDays,
      })
      .select("id")
      .single();
    if (error) failed += 1;
    else {
      done.added += 1;
      if (made?.id) diff.adds[i]!.enrollmentId = made.id as string;
      if (a.onHold) heldAdds += 1;
    }
  }

  await finish();
  return {
    applied: { classes: counts.classes, ...done },
    heldAdds,
    failed,
    effectiveDate: effective,
    snapshotId,
  };
}
