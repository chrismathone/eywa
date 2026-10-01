"use server";

import { getCurrentUser } from "@/lib/auth/current-user";
import { canManageTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { kstToday } from "@/lib/date-kst";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import type { TransferCandidate } from "../bulk-transfer";
import { logDbError } from "@/lib/supabase/db-error";

/**
 * **반이동 예약의 출발지 후보** — 그 학생이 지금(또는 앞으로) 다니는 수강 한 줄.
 *
 * 수강 배정 창의 '반이동' 토글(원장 2026-09-18 *"기존 수업이 있는 학생에게 '새로운 수강 배정'을 하려고
 * 하는 경우 … '반이동' 토글시 해당 반으로 자연스럽게 반이동 처리"*)이 "어느 반에서 옮기나"를 묻는 재료다.
 *
 * 🔴 **화면에 미리 실어 보내지 않는다** — 반 상세('학생 배정')는 학생을 창 안에서 고르므로, 전 학생의
 *    수강을 미리 내려보내면 페이로드가 명단 크기만큼 커진다(반응속도). 토글을 켤 때 그 학생 것만 부른다.
 * 🔴 게이트는 **이동을 만드는 것과 같은 문**(`canManageTenant("classes")` — `moveEnrollmentsBatch`와 동일).
 *    후보 목록 자체가 "이 학생이 어느 반에 다니나"라서 조회에도 같은 권한을 요구한다([[#77]]).
 */
export type MovableEnrollment = {
  enrollmentId: string;
  classId: string;
  className: string;
  subject: string | null;
  startDate: string;
  endDate: string | null;
  /** 이 수강의 등원 요일(분리등원) — 목적지 반으로 승계할 기본값. */
  attendanceDays: string[] | null;
};

export type MovableEnrollmentsState =
  | { ok: true; items: MovableEnrollment[] }
  | { ok: false; error: string };

export async function listMovableEnrollments(
  studentId: string,
): Promise<MovableEnrollmentsState> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes")))
    return { ok: false, error: "반 이동은 관리자만 할 수 있습니다" };
  if (!/^[0-9a-f-]{36}$/i.test(studentId))
    return { ok: false, error: "학생을 확인할 수 없습니다" };

  const supabase = await createClient();
  const today = kstToday();
  // 🔴 **아직 안 끝난 수강만**(종료일이 없거나 오늘보다 뒤) — 이미 끝난 수강은 옮길 것이 없다.
  //    ⚠️ `end_date = 오늘`은 오늘까지만 다니는 수강이라 제외한다(내일 이동은 옮길 대상이 없다).
  const { data, error } = await supabase
    .from("enrollments")
    .select("id, class_id, start_date, end_date, attendance_days")
    .eq("tenant_id", user.tenantId)
    .eq("student_id", studentId)
    .eq("is_transferred", false)
    .or(`end_date.is.null,end_date.gt.${today}`)
    .order("start_date", { ascending: true });
  if (error) {
    logDbError(error, "enrollments.listMovableEnrollments");
    return { ok: false, error: "수강 목록을 불러오지 못했습니다" };
  }
  const rows = data ?? [];
  if (!rows.length) return { ok: true, items: [] };

  // 🔴 반 이름은 **따로 읽는다** — `classes(...)` 임베드는 FK가 둘 이상이 되는 날 조용히 HTTP 300으로
  //    죽는다([[#94]]). 한 학생의 수강은 많아야 열 줄 남짓이라 `.in()`이 길어질 위험도 없다.
  const { data: classRows } = await supabase
    .from("classes")
    .select("id, class_name, subject")
    .eq("tenant_id", user.tenantId)
    .in("id", [...new Set(rows.map((r) => String(r.class_id)))]);
  const classById = new Map(
    (classRows ?? []).map((c) => [String(c.id), { name: c.class_name as string, subject: c.subject as string | null }]),
  );

  const items = rows.map((row) => {
    const klass = classById.get(String(row.class_id));
    return {
      enrollmentId: String(row.id),
      classId: String(row.class_id),
      // 조회가 반을 못 찾아도 **줄을 지우지 않는다** — 옮길 수 있는 수강을 숨기면 사람이 길을 잃는다.
      className: klass?.name ?? "이름 없는 반",
      subject: klass?.subject ?? null,
      startDate: String(row.start_date),
      endDate: (row.end_date as string | null) ?? null,
      attendanceDays: (row.attendance_days as string[] | null) ?? null,
    };
  });
  return { ok: true, items };
}

/** 단체 반 이동을 켤 때만 같은 출발 반의 수강을 조회한다. */
export async function listClassTransferCandidates(enrollmentId: string): Promise<
  | { ok: true; classId: string; className: string; items: TransferCandidate[] }
  | { ok: false; error: string }
> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "로그인이 필요합니다" };
  if (!(await canManageTenant(user.systemRole, "classes")))
    return { ok: false, error: "반 이동은 관리자만 할 수 있습니다" };
  if (!/^[0-9a-f-]{36}$/i.test(enrollmentId))
    return { ok: false, error: "기존 수강을 확인할 수 없습니다" };
  const db = await createClient();
  try {
    const { data: source, error } = await db.from("enrollments").select("class_id")
      .eq("tenant_id", user.tenantId).eq("id", enrollmentId).maybeSingle();
    if (error || !source) {
      logDbError(error, "enrollments.listClassTransferCandidates");
      return { ok: false, error: "기존 수강을 찾을 수 없습니다" };
    }
    const [klass, rows] = await Promise.all([
      db.from("classes").select("class_name").eq("tenant_id", user.tenantId).eq("id", source.class_id).single(),
      fetchAllPaged((from, to) => db.from("enrollments")
        .select("id, student_id, start_date, end_date, attendance_days, on_hold, is_transferred")
        .eq("tenant_id", user.tenantId).eq("class_id", source.class_id)
        .or(`end_date.is.null,end_date.gte.${kstToday()}`).order("id").range(from, to)),
    ]);
    if (klass.error) throw klass.error;
    const students = await fetchInChunks([...new Set(rows.map((r) => r.student_id as string))],
      (ids) => db.from("students").select("id, name, school, grade").eq("tenant_id", user.tenantId).in("id", ids));
    const byId = new Map(students.map((s) => [s.id, s]));
    const items: TransferCandidate[] = rows.map((r) => {
      const student = byId.get(r.student_id);
      if (!student) throw new Error("student_missing");
      return {
        id: r.id, name: student.name, school: student.school, grade: student.grade,
        snapshot: {
          studentId: r.student_id, startDate: r.start_date, endDate: r.end_date,
          onHold: r.on_hold, isTransferred: r.is_transferred, attendanceDays: r.attendance_days,
        },
      };
    });
    items.sort((a, b) => a.name.localeCompare(b.name, "ko") || a.id.localeCompare(b.id));
    return { ok: true, classId: source.class_id, className: klass.data.class_name, items };
  } catch {
    return { ok: false, error: "같은 반 학생 목록을 불러오지 못했습니다. 다시 불러와 주세요." };
  }
}
