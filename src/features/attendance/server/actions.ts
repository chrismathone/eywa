"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { notifyIfClassAttendanceComplete } from "./complete-notify";
import { getCurrentUser } from "@/lib/auth/current-user";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { createClient } from "@/lib/supabase/server";
import { parseSessionUnits } from "../session-units";
import { attendanceLockMessage, isWithinAttendanceEditWindow } from "../edit-window";
import { kstToday } from "@/lib/date-kst";
import { schoolGradeLabel } from "@/lib/format/school-grade";

const STATUSES = ["present", "absent", "late", "excused", "makeup", "early_leave"] as const;
type Status = (typeof STATUSES)[number];

export type SaveAttendanceState = { error?: string; saved?: number } | undefined;

/**
 * Save attendance for a single class on a single date. Format:
 *   classId, date, then rows `status:{studentId}=<status>` for each student.
 *   Also accepts `note:{studentId}`, `homeworkRequired:{studentId}`, `homeworkDone:{studentId}`.
 * Empty status = leave alone (no record created).
 */
export async function saveAttendance(
  _prev: SaveAttendanceState,
  formData: FormData,
): Promise<SaveAttendanceState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const classId = String(formData.get("classId") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim();
  if (!classId || !date) return { error: "반과 날짜가 필요합니다" };

  type Row = {
    studentId: string;
    status: Status;
    existingId: string | null;
    note: string | null;
    homeworkRequired: boolean;
    homeworkDone: boolean;
    sessionUnits: number | null;
  };
  const rows: Row[] = [];

  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("status:")) continue;
    const studentId = key.slice("status:".length);
    const status = String(value);
    if (!status) continue;
    if (!STATUSES.includes(status as Status)) continue;
    const existingId =
      String(formData.get(`existing:${studentId}`) ?? "").trim() || null;
    const note =
      String(formData.get(`note:${studentId}`) ?? "").trim() || null;
    const homeworkRequired =
      String(formData.get(`homeworkRequired:${studentId}`) ?? "") === "true";
    const homeworkDone =
      String(formData.get(`homeworkDone:${studentId}`) ?? "") === "true";
    // 시수(배수, 0115a) — 빈 값·1 = 기본(null). 잘못된 입력은 행 단위로 즉시 반려.
    const parsedUnits = parseSessionUnits(String(formData.get(`units:${studentId}`) ?? ""));
    if (!parsedUnits.ok) {
      const name = String(formData.get(`name:${studentId}`) ?? "").trim();
      return { error: `${name || "학생"} 시수 입력 오류 — ${parsedUnits.error}` };
    }
    rows.push({
      studentId,
      status: status as Status,
      existingId,
      note,
      homeworkRequired,
      homeworkDone,
      sessionUnits: parsedUnits.value,
    });
  }

  if (rows.length === 0) return { error: "저장할 출결 데이터가 없습니다" };

  // 수정 가능 기간 — 강사(scoped)는 세션일로부터 7일 이내만. 관리자 이상(full)은 제한 없음(원장 2026-07-21).
  // ⚠️ 화면에서만 잠그면 우회할 수 있다(#77) — 쓰기 경로 **양쪽**(이 액션과 setAttendanceCell)에 서버 게이트를 둔다.
  // ⚠️ 기준일은 항상 **KST 오늘**. 서버는 UTC라 new Date()로 재면 한국 새벽에 하루가 밀린다.
  const supabase = await createClient();

  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!isWithinAttendanceEditWindow(date, kstToday())) {
      return { error: attendanceLockMessage(date, kstToday()) };
    }
    // ⚠️ 담당 반 강제 — 예전엔 이 액션에 **반 소유 검사가 아예 없었다**(셀 토글 setAttendanceCell에만 있었음).
    // RLS는 tenant 격리뿐이라, 강사가 폼을 직접 POST하면 학원 내 아무 반 출결이나 쓸 수 있었다
    // (2026-07-21 적대검증 미수리분 "출석부 scoped 검증 부재=보안·돈"). 아래 보강 추가로 **임의 학생**까지
    // 폼에 실을 수 있게 되므로, 그 문을 열기 전에 이 게이트를 먼저 닫는다(#77).
    const { count: ownClass } = await supabase
      .from("classes")
      .select("*", { count: "exact", head: true })
      .eq("id", classId)
      .eq("teacher_id", user.id);
    if (!ownClass) return { error: "담당 반이 아닙니다" };
  }

  const nowIso = new Date().toISOString();

  // Split into updates (existing row) and inserts (new)
  const updates = rows.filter((r) => r.existingId);
  const inserts = rows.filter((r) => !r.existingId);

  let saved = 0;

  for (const r of updates) {
    const { error } = await supabase
      .from("attendance_records")
      .update({
        status: r.status,
        note: r.note,
        homework_required: r.homeworkRequired,
        homework_done: r.homeworkDone,
        session_units: r.sessionUnits,
        recorded_by: user.id,
        recorded_at: nowIso,
      })
      .eq("id", r.existingId!);
    if (error) return { error: error.message };
    saved++;
  }

  if (inserts.length > 0) {
    const { error } = await supabase.from("attendance_records").insert(
      inserts.map((r) => ({
        tenant_id: user.tenantId,
        class_id: classId,
        student_id: r.studentId,
        session_date: date,
        status: r.status,
        note: r.note,
        homework_required: r.homeworkRequired,
        homework_done: r.homeworkDone,
        session_units: r.sessionUnits,
        recorded_by: user.id,
      })),
    );
    if (error) return { error: error.message };
    saved += inserts.length;
  }

  // G4: 전원 기록 완료 전이 감지 → 담당 강사 벨(백그라운드, 응답 안 막음 — 실패해도 저장 무사).
  after(() =>
    notifyIfClassAttendanceComplete({ tenantId: user.tenantId, classId, date, actorId: user.id }),
  );
  revalidatePath(`/attendance/${date}`);
  revalidatePath(`/attendance/${date}/${classId}`);
  redirect(`/attendance/${date}?saved=${saved}`);
}

export type CellResult = { ok: true } | { error: string };

/**
 * 매트릭스 인라인 셀 1건 출결 토글 — 페이지 이동 없이 빠르게 찍는다(반응속도 1순위).
 * status=null 이면 해당 셀 기록 삭제(지우기). 기존 record가 있으면 update, 없으면 insert.
 * 상세 입력폼(메모·숙제)은 별도 유지 — 여기선 상태·메모·시수만 다룬다.
 */
export async function setAttendanceCell(input: {
  studentId: string;
  classId: string;
  sessionDate: string;
  status: Status | null;
  note?: string | null; // 전달 시 메모도 갱신(undefined면 기존 메모 유지)
  units?: string; // 전달 시 시수도 갱신(raw 입력 — 서버에서 파싱, ""=기본 1). undefined면 기존 유지.
}): Promise<CellResult> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return { error: "출석 관리 권한이 없습니다" };

  const { studentId, classId, sessionDate, status } = input;
  const noteProvided = input.note !== undefined;
  const noteVal = (input.note ?? "").trim() || null;
  if (!studentId || !classId || !sessionDate) return { error: "필수 값이 누락되었습니다" };
  if (status !== null && !STATUSES.includes(status)) return { error: "잘못된 상태입니다" };

  const unitsProvided = input.units !== undefined;
  let unitsVal: number | null = null;
  if (unitsProvided) {
    const parsed = parseSessionUnits(input.units);
    if (!parsed.ok) return { error: parsed.error };
    unitsVal = parsed.value;
  }

  const supabase = await createClient();

  // scoped(강사) 담당 반 강제 — 원스크린 인라인 출결(2단계)이 이 액션을 재사용하면서 서버 검증 추가.
  // RLS는 tenant 격리뿐이라 여기서 막지 않으면 강사가 테넌트 내 아무 반에나 기록 가능(검수 지적).
  // full(관리자 계열·겸직 포함)은 기존대로 전 반. 담당 확인 + 수강생 확인은 독립 조회 → 병렬(B4).
  // ⚠️ 수강생 판정은 **세션 날짜 기준**(start≤date AND (end null OR end≥date)) — 출석부 매트릭스는 그 달 중
  //    수강 종료(반이동·종강)된 학생의 과거 셀도 편집을 허용하므로, end_date IS NULL 고정이면 그 교정과
  //    미래 end_date(퇴원 예정) 재원생의 오늘 출결까지 차단되는 회귀(리뷰 확정). getAttendanceInputRows와 동일 의미.
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(sessionDate)) return { error: "잘못된 날짜입니다" }; // .or() 보간 안전
    // 7일 지난 출결은 강사가 못 고친다(원장 2026-07-21). 기준일은 항상 KST 오늘.
    if (!isWithinAttendanceEditWindow(sessionDate, kstToday())) {
      return { error: attendanceLockMessage(sessionDate, kstToday()) };
    }
    const [{ count: ownClass }, { count: enrolled }] = await Promise.all([
      supabase
        .from("classes")
        .select("*", { count: "exact", head: true })
        .eq("id", classId)
        .eq("teacher_id", user.id),
      supabase
        .from("enrollments")
        .select("*", { count: "exact", head: true })
        .eq("class_id", classId)
        .eq("student_id", studentId)
        .or(`start_date.is.null,start_date.lte.${sessionDate}`)
        .or(`end_date.is.null,end_date.gte.${sessionDate}`),
    ]);
    if (!ownClass) return { error: "담당 반이 아닙니다" };
    if (!enrolled) return { error: "이 반 수강생이 아닙니다" };
  }

  // 지우기 — 해당 (반·학생·날짜) 기록 전부 삭제.
  if (status === null) {
    const { error } = await supabase
      .from("attendance_records")
      .delete()
      .eq("class_id", classId)
      .eq("student_id", studentId)
      .eq("session_date", sessionDate);
    if (error) return { error: error.message };
    revalidatePath("/attendance");
    return { ok: true };
  }

  // 최신 기록 1건 조회 → 있으면 update, 없으면 insert (매트릭스는 최신본을 보여줌).
  const { data: existing } = await supabase
    .from("attendance_records")
    .select("id")
    .eq("class_id", classId)
    .eq("student_id", studentId)
    .eq("session_date", sessionDate)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const nowIso = new Date().toISOString();
  if (existing?.id) {
    const patch: Record<string, unknown> = { status, recorded_by: user.id, recorded_at: nowIso };
    if (noteProvided) patch.note = noteVal;
    if (unitsProvided) patch.session_units = unitsVal;
    const { error } = await supabase.from("attendance_records").update(patch).eq("id", existing.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await supabase.from("attendance_records").insert({
      tenant_id: user.tenantId,
      class_id: classId,
      student_id: studentId,
      session_date: sessionDate,
      status,
      note: noteProvided ? noteVal : null,
      session_units: unitsProvided ? unitsVal : null,
      recorded_by: user.id,
    });
    if (error) return { error: error.message };
  }

  // G4: 셀 저장(삽입/갱신)마다 완료 전이 검사 — 삭제 경로는 위에서 조기 반환이라 미발화(기록 제거는 완료가 아님).
  after(() =>
    notifyIfClassAttendanceComplete({ tenantId: user.tenantId, classId, date: sessionDate, actorId: user.id }),
  );
  revalidatePath("/attendance");
  return { ok: true };
}

/**
 * 보강(수업외) 학생 검색 — 출석 입력 화면 '+ 보강 학생 추가' 피커.
 *
 * 원스크린의 같은 이름 액션과 **의도적으로 분리**했다: 이 표면은 출결(=시수·급여 재료)을 쓰므로
 * 자기 게이트를 자기가 통과해야 한다(#77 — 화면이 아니라 액션이 게이트). 강사(scoped)는 담당 반일 때만
 * 검색할 수 있어, 남의 반 화면을 억지로 열어 학원 전체 명단을 훑는 경로를 막는다.
 * 퇴원생은 제외(보강 대상이 아님), 최대 20건.
 */
export async function searchMakeupStudents(
  classId: string,
  query: string,
): Promise<{ id: string; name: string; label: string }[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  if (!(await canWriteTenant(user.systemRole, "attendance"))) return [];
  const q = query.trim();
  if (!q || !classId) return [];
  const supabase = await createClient();
  if ((await accessLevelTenant(user.systemRole, "attendance")) === "scoped") {
    const { count: ownClass } = await supabase
      .from("classes")
      .select("*", { count: "exact", head: true })
      .eq("id", classId)
      .eq("teacher_id", user.id);
    if (!ownClass) return [];
  }
  const { data } = await supabase
    .from("students")
    .select("id, name, grade, school")
    .neq("status", "withdrawn")
    .ilike("name", `%${q}%`)
    .order("name", { ascending: true })
    .limit(20);
  return (data ?? []).map((s) => ({
    id: s.id,
    name: s.name,
    label: schoolGradeLabel(s.school ?? null, s.grade ?? null),
  }));
}
