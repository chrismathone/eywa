"use server";

/**
 * aywa 학생 ↔ ClassNote 원아 **고정 연결(pin)** 쓰기 — 0145a.
 *
 * 🔴 **이 파일의 유일한 위험은 오발송이다**(원장 지시 2026-07-23: "이상하게 pin 되서 보고서
 * 오발송되지 않도록 아주 꼼꼼해야 함"). 화면이 실수하거나, 누가 요청을 조작하거나, 그 사이 데이터가
 * 바뀌어도 **엉뚱한 원아에 연결되면 안 된다.** 그래서 화면이 이미 걸러 보낸 값도 여기서 **전부 다시 검증**한다.
 *
 * 통과해야 하는 관문 7개(하나라도 실패하면 저장하지 않는다):
 *   G1 권한      — canWriteTenant('lesson_reports')
 *   G2 학생      — 이 테넌트의 **재원** 학생이고, 테스트 학생이 아니다
 *   G3 반·보드   — 그 보드가 **그 학생이 실제로 듣는 반**의 보드다(임의 board_id 주입 차단)
 *   G4 원아      — 그 원아가 **그 보드의 현재 스냅샷 멤버**다(유령 child_id 차단)
 *   G5 생년      — 학년에서 역산한 기대 생년과 ±1년. **모르면 거부**(생년 없음·학년 없음 = 연결 불가)
 *   G6 중복      — 그 원아가 이미 다른 학생과 연결돼 있지 않다(DB unique와 이중 방어)
 *   G7 이름매칭  — 그 원아가 **다른 학생의 확실한 이름 매칭**이 아니다(남의 원아 뺏기 차단)
 *
 * 스냅샷이 낡으면(워커 정지) G4가 옛 명단을 보게 되므로 **staleness도 막는다**(MAX_SNAPSHOT_AGE_DAYS).
 */

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { humanizeDbError } from "@/lib/supabase/db-error";
import { kstToday } from "@/lib/date-kst";
import { classKey, boardKey } from "../english-writing";
import { birthYearMatches, kstSchoolYear, matchMembers } from "../board-roster-diff";
import { getTenantSettings } from "@/features/owner/server/queries";
import { classnoteModuleOn } from "@/features/owner/classnote-gate";

/** 스냅샷이 이보다 오래되면 연결을 막는다 — 낡은 명단으로 못 박으면 이미 떠난 원아에 붙을 수 있다. */
const MAX_SNAPSHOT_AGE_DAYS = 7;

export type PinResult = { ok: true } | { ok: false; error: string };

export async function linkClassnoteChild(input: {
  studentId: string;
  boardId: number;
  childId: number;
}): Promise<PinResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  // G1 권한 — 발송 대상을 정하는 행위라 보고서 쓰기 권한과 같은 등급으로 본다.
  if (!(await canWriteTenant(user.systemRole, "lesson_reports")))
    return { ok: false, error: "연결할 권한이 없습니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };

  const studentId = String(input.studentId ?? "").trim();
  const boardId = Number(input.boardId);
  const childId = Number(input.childId);
  if (!studentId || !Number.isFinite(boardId) || !Number.isFinite(childId))
    return { ok: false, error: "요청 값이 올바르지 않습니다" };

  const supabase = await createClient();
  const today = kstToday();

  // G2 학생 — RLS가 테넌트를 막고, 여기서 상태를 본다. 퇴원·테스트 학생은 연결 대상이 아니다.
  const { data: student } = await supabase
    .from("students")
    .select("id, name, classnote_name, grade, status, is_test")
    .eq("id", studentId)
    .maybeSingle();
  if (!student) return { ok: false, error: "학생을 찾을 수 없습니다" };
  if (student.status !== "enrolled") return { ok: false, error: "재원 중인 학생만 연결할 수 있습니다" };
  if (student.is_test) return { ok: false, error: "테스트 학생은 연결하지 않습니다" };

  // G4(전반) 보드 — 스냅샷에 있고, 너무 낡지 않아야 한다.
  const { data: board } = await supabase
    .from("classnote_boards")
    .select("board_id, board_name, synced_at")
    .eq("board_id", boardId)
    .maybeSingle();
  if (!board) return { ok: false, error: "ClassNote 보드 정보가 없습니다(워커 동기화 후 다시 시도해 주세요)" };
  const ageDays = (Date.now() - new Date(board.synced_at as string).getTime()) / 86_400_000;
  if (!(ageDays <= MAX_SNAPSHOT_AGE_DAYS))
    return { ok: false, error: `ClassNote 정보가 ${Math.floor(ageDays)}일 지났습니다 — 동기화 후 다시 시도해 주세요` };

  // G3 반·보드 — 이 학생이 듣는 활성 반 중, 이름이 이 보드와 맞는 반이 있어야 한다.
  //     (화면을 거치지 않고 임의 board_id를 보내는 경로를 막는다.)
  const { data: enrolled } = await supabase
    .from("enrollments")
    .select("end_date, classes ( id, class_name, is_active )")
    .eq("student_id", studentId);
  const targetKey = boardKey(board.board_name as string);
  const matchedClass = (enrolled ?? []).find((e) => {
    const c = (Array.isArray(e.classes) ? e.classes[0] : e.classes) as { class_name?: string; is_active?: boolean } | null;
    if (!c?.is_active) return false;
    if (e.end_date && (e.end_date as string) < today) return false;
    return classKey(c.class_name ?? "") === targetKey;
  });
  if (!matchedClass) return { ok: false, error: "이 학생이 듣는 반의 보드가 아닙니다" };

  // G4 원아 — 그 보드의 현재 멤버여야 한다.
  const { data: members } = await supabase
    .from("classnote_board_members")
    .select("child_id, child_name, birth_year")
    .eq("board_id", boardId);
  const child = (members ?? []).find((m) => Number(m.child_id) === childId);
  if (!child) return { ok: false, error: "그 원아가 이 보드에 없습니다" };

  // G5 생년 — 🔴 마지막 관문. 모르면 거부한다.
  if (!birthYearMatches(student.grade as string | null, child.birth_year as number | null, kstSchoolYear()))
    return {
      ok: false,
      error:
        child.birth_year == null
          ? "원아 생년이 없어 같은 학생인지 확인할 수 없습니다"
          : `생년(${child.birth_year})이 학년(${student.grade ?? "없음"})과 맞지 않아 연결할 수 없습니다`,
    };

  // G6 중복 — 그 원아가 이미 다른 학생과 연결돼 있으면 거부(DB unique와 이중 방어).
  const { data: taken } = await supabase
    .from("classnote_student_links")
    .select("student_id")
    .eq("board_id", boardId)
    .eq("child_id", childId)
    .maybeSingle();
  if (taken && taken.student_id !== studentId)
    return { ok: false, error: "이 원아는 이미 다른 학생과 연결돼 있습니다" };

  // G7 이름매칭 — 그 원아가 **다른 재원생의 확실한 이름 매칭**이면 뺏지 않는다.
  //     (같은 반 로스터 전체를 대상으로, 그 원아를 이름으로 집는 학생이 나 말고 또 있는지 본다.)
  const cls = (Array.isArray(matchedClass.classes) ? matchedClass.classes[0] : matchedClass.classes) as { id: string };
  const { data: mates } = await supabase
    .from("enrollments")
    .select("end_date, students ( id, name, classnote_name, status, is_test )")
    .eq("class_id", cls.id);
  const one = [{ childId, childName: child.child_name as string, birthYear: child.birth_year as number | null }];
  for (const m of mates ?? []) {
    if (m.end_date && (m.end_date as string) < today) continue;
    const s = (Array.isArray(m.students) ? m.students[0] : m.students) as
      | { id: string; name: string; classnote_name: string | null; status: string; is_test: boolean }
      | null;
    if (!s || s.id === studentId || s.status !== "enrolled" || s.is_test) continue;
    const eff = (s.classnote_name?.trim() || s.name || "").trim();
    if (eff && matchMembers(eff, one).length > 0)
      return { ok: false, error: `이 원아는 같은 반 ${s.name} 학생의 이름과 일치합니다 — 연결하지 않습니다` };
  }

  const { error } = await supabase.from("classnote_student_links").insert({
    tenant_id: user.tenantId,
    student_id: studentId,
    board_id: boardId,
    child_id: childId,
    child_name_at_link: child.child_name as string,
    birth_year_at_link: child.birth_year as number | null,
    // 연결 기록의 명의는 강사뷰면 대상 X(아래 audit_logs 행위자는 실제 계정 그대로).
    linked_by: (await getCurrentUser({ teacherView: true }))?.id ?? user.id,
  });
  if (error) return { ok: false, error: humanizeDbError(error.message, "저장") };

  // 누가 언제 무엇을 연결했는지 남긴다 — 오발송 조사 시 첫 단서.
  await supabase.from("audit_logs").insert({
    tenant_id: user.tenantId,
    actor_id: user.id,
    actor_name: user.displayName ?? null,
    action: "classnote_child_link",
    target_type: "student",
    target_label: student.name as string,
    metadata: { studentId, boardId, boardName: board.board_name, childId, childName: child.child_name, birthYear: child.birth_year },
  });

  revalidatePath("/lesson-reports");
  return { ok: true };
}

/** 연결 해제 — 되돌리기는 항상 열려 있어야 한다(잘못 눌러도 막다른 길이 되지 않게). */
export async function unlinkClassnoteChild(input: { studentId: string; boardId: number }): Promise<PinResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "lesson_reports")))
    return { ok: false, error: "해제할 권한이 없습니다" };
  if (!classnoteModuleOn(await getTenantSettings())) return { ok: false, error: "사용할 수 없는 기능입니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("classnote_student_links")
    .delete()
    .eq("student_id", String(input.studentId))
    .eq("board_id", Number(input.boardId));
  if (error) return { ok: false, error: humanizeDbError(error.message, "해제") };

  await supabase.from("audit_logs").insert({
    tenant_id: user.tenantId,
    actor_id: user.id,
    actor_name: user.displayName ?? null,
    action: "classnote_child_unlink",
    target_type: "student",
    target_label: String(input.studentId),
    metadata: { studentId: String(input.studentId), boardId: Number(input.boardId) },
  });

  revalidatePath("/lesson-reports");
  return { ok: true };
}
