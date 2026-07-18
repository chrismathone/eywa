"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { accessLevelTenant, canWriteTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { notifyClassAssignment } from "@/features/notifications/server/notify";

export type CreateEnrollmentState =
  | { error?: string; enrollmentId?: string }
  | undefined;

const DAY_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
const VALID_DAYS = new Set<string>(DAY_ORDER);

/**
 * 분리등원 요일 정규화 — 선택 요일을 수업 운영 요일 교집합으로 좁히고 요일순 정렬한다.
 * 비어있거나 수업의 전 요일을 다 고르면 [] 반환(= 전 요일 등원, 분리등원 아님 — GiST 충돌·표시 일관).
 */
async function normalizeAttendanceDays(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classId: string,
  picked: string[],
): Promise<string[]> {
  if (picked.length === 0) return [];
  const { data: scheds } = await supabase
    .from("class_schedules")
    .select("day_of_week")
    .eq("class_id", classId);
  const classDays = new Set<string>((scheds ?? []).map((s) => s.day_of_week as string));
  if (classDays.size === 0) return []; // 스케줄 없는 반 — 요일 제약 의미 없음
  const within = picked.filter((d) => classDays.has(d));
  // 전 요일을 다 골랐으면 제약 없음(=[]).
  if (within.length === 0 || within.length >= classDays.size) return [];
  return DAY_ORDER.filter((d) => within.includes(d));
}

/**
 * 학생을 반에 배정.
 * - GiST EXCLUDE 제약으로 학생의 다른 enrollment와 시간 겹침은 자동 차단됨.
 * - UI 단에서 미리 detectStudentScheduleConflicts로 경고할 수 있음.
 */
export async function createEnrollment(
  _prev: CreateEnrollmentState,
  formData: FormData,
): Promise<CreateEnrollmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // "반 배정"은 반 상세(classes) + 학생 상세(students) 양쪽에서 호출 — 둘 중 하나라도 쓰기면 허용
  // (counselor는 classes=none이나 students=full로 학생 상세에서 배정. 회계/뷰어=양쪽 readonly/none → 차단).
  if (
    !(await canWriteTenant(user.systemRole, "classes")) &&
    !(await canWriteTenant(user.systemRole, "students"))
  ) {
    return { error: "반 배정 권한이 없습니다" };
  }

  const studentId = String(formData.get("studentId") ?? "").trim();
  const classId = String(formData.get("classId") ?? "").trim();
  const startDate =
    String(formData.get("startDate") ?? "").trim() || kstToday();
  const endDate = String(formData.get("endDate") ?? "").trim() || null;
  // 분리등원: 콤마구분 요일(예 "mon,thu"). 비거나 수업의 전 요일이면 [] = 전 요일 등원.
  const pickedDays = String(formData.get("attendanceDays") ?? "")
    .split(",")
    .map((d) => d.trim())
    .filter((d) => VALID_DAYS.has(d));

  if (!studentId) return { error: "학생을 선택해주세요" };
  if (!classId) return { error: "반을 선택해주세요" };

  const supabase = await createClient();

  // 반이 본 테넌트 것인지 검증(RLS로 스코프 — 타 테넌트 반 id면 null). enrollments RLS가 class_id의
  // 테넌트를 검증하지 않아 조작된 foreign class로 유령 수강이 생기는 것을 막는다(적대리뷰).
  const { data: klass } = await supabase.from("classes").select("id").eq("id", classId).maybeSingle();
  if (!klass) return { error: "반을 찾을 수 없습니다" };

  // 수업의 운영 요일 — 선택값을 그 안으로 좁히고, "전 요일 선택"이면 []로 정규화(분리등원 아님).
  const attendanceDays = await normalizeAttendanceDays(supabase, classId, pickedDays);

  const { data, error } = await supabase
    .from("enrollments")
    .insert({
      tenant_id: user.tenantId,
      student_id: studentId,
      class_id: classId,
      start_date: startDate,
      end_date: endDate,
      attendance_days: attendanceDays,
    })
    .select("id")
    .single();

  if (error || !data) {
    if (error?.message?.includes("conflicting_period")) {
      return { error: "이 학생이 같은 시간대 다른 반에 이미 배정되어 있습니다" };
    }
    // daterange lower>upper — 종료일이 시작일보다 빠름(원문 영어 에러 대신 친절 메시지).
    if (error?.message?.includes("range lower bound")) {
      return { error: "종료일이 시작일보다 빠릅니다. 날짜를 확인해 주세요." };
    }
    return { error: error?.message ?? "수강 배정 실패" };
  }

  // 담당 강사(반 담임)에게 인앱 알림 — best-effort(실패해도 배정은 성공).
  await notifyClassAssignment({
    tenantId: user.tenantId,
    actorId: user.id,
    assignments: [{ classId, studentId }],
    type: "enrollment_assigned",
  });

  revalidatePath("/timetable");
  revalidatePath(`/students/${studentId}`);
  revalidatePath(`/classes/${classId}`);
  return { enrollmentId: data.id };
}

export type MoveEnrollmentState = { error?: string } | undefined;

/**
 * 학생을 한 반에서 다른 반으로 이동.
 * 기존 enrollment 종료 + 새 enrollment 생성 (transactional 흐름).
 */
export async function moveEnrollment(
  _prev: MoveEnrollmentState,
  formData: FormData,
): Promise<MoveEnrollmentState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "반 배정 권한이 없습니다" };

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const newClassId = String(formData.get("newClassId") ?? "").trim();
  const startDate =
    String(formData.get("startDate") ?? "").trim() || kstToday();

  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };
  if (!newClassId) return { error: "이동할 반을 선택해주세요" };

  const supabase = await createClient();
  const { data: current } = await supabase
    .from("enrollments")
    .select("student_id, end_date")
    .eq("id", enrollmentId)
    .single();
  if (!current) return { error: "기존 수강 정보를 찾을 수 없습니다" };

  // 1) 기존 enrollment 종료
  const today = kstToday();
  const { error: endErr } = await supabase
    .from("enrollments")
    .update({ end_date: today, withdrawal_reason: "반 이동" })
    .eq("id", enrollmentId);
  if (endErr) return { error: endErr.message };

  // 2) 새 enrollment INSERT
  const { error: newErr } = await supabase.from("enrollments").insert({
    tenant_id: user.tenantId,
    student_id: current.student_id,
    class_id: newClassId,
    start_date: startDate,
  });

  if (newErr) {
    // 새 enrollment 실패 - 기존 복구 시도
    await supabase
      .from("enrollments")
      .update({ end_date: current.end_date, withdrawal_reason: null })
      .eq("id", enrollmentId);
    if (newErr.message?.includes("conflicting_period")) {
      return { error: "학생이 같은 시간대 다른 반에 이미 배정되어 있습니다" };
    }
    return { error: newErr.message };
  }

  revalidatePath("/timetable");
  return undefined;
}

export type BatchMoveInput = {
  enrollmentId: string;
  newClassId: string;
  startDate?: string;
  /** 목적지 등원 요일(분리등원) — 요일 존 드롭=[그 요일], 공통 존=[](전 요일). 비면 전 요일 등원. */
  attendanceDays?: string[];
};
export type BatchMoveResult = {
  enrollmentId: string;
  ok: boolean;
  error?: string;
};
export type MoveEnrollmentsBatchState = {
  error?: string;
  results?: BatchMoveResult[];
};

/**
 * 편집 모드 '저장' — 보류 이동들을 한 번에 커밋. 압축은 클라(compressMoves)에서 끝낸 결과를 받는다.
 * move_enrollments_batch RPC(SECURITY INVOKER + per-move 서브트랜잭션)로 RLS 유지 + 원자성 확보.
 * 1건이 GiST 시간겹침 등으로 실패해도 나머지는 커밋되고, 실패 목록을 results로 돌려준다.
 */
export async function moveEnrollmentsBatch(
  moves: BatchMoveInput[],
  /** 적용일(YYYY-MM-DD) — 미래 주 편집 시 그 주 월요일. 미지정/오늘이면 즉시 이동. (Phase B 주간 이동) */
  effectiveDate?: string,
): Promise<MoveEnrollmentsBatchState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "반 배정 권한이 없습니다" };
  if (!Array.isArray(moves) || moves.length === 0) return { results: [] };

  const eff =
    effectiveDate && /^\d{4}-\d{2}-\d{2}$/.test(effectiveDate) ? effectiveDate : null;
  // ⚠️ 과거 적용일 거부 — RPC는 이 값을 **옛 수강의 end_date와 새 수강의 start_date에 그대로** 쓰므로,
  // 과거 날짜를 넣으면 이미 지난 출결·청구 구간을 소급 조작한다. 클라 `min={dateFloor}`는 UI일 뿐
  // 게이트가 아니다(#77 — 화면에서만 잠근 것은 잠근 게 아니다). 2026-07-17 적대 감사 F6.
  if (eff && eff < kstToday()) return { error: "적용일은 오늘 이후여야 합니다" };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("move_enrollments_batch", {
    p_moves: moves.map((m) => ({
      enrollmentId: m.enrollmentId,
      newClassId: m.newClassId,
      startDate: m.startDate ?? null,
      // 유효 요일코드만(mon..sun) 요일순 — 목적지 반 스케줄 밖 요일은 표시가 알아서 걸러지므로 서버 정규화는 최소.
      attendanceDays: DAY_ORDER.filter((d) => (m.attendanceDays ?? []).includes(d)),
    })),
    p_effective_date: eff,
  });

  if (error) return { error: error.message };

  const results = (data ?? []) as BatchMoveResult[];

  // 목적지 반 담임에게 전입 알림 — 성공한 이동만. 학생 id는 이동한 (구)enrollment 행에서 조회
  // (RPC 결과엔 enrollmentId만 있고 studentId·newClassId는 입력 moves에 있음). best-effort.
  const okIds = new Set(results.filter((r) => r.ok).map((r) => r.enrollmentId));
  const okMoves = moves.filter((m) => okIds.has(m.enrollmentId));
  if (okMoves.length > 0) {
    const { data: enrRows } = await supabase
      .from("enrollments")
      .select("id, student_id")
      .in(
        "id",
        okMoves.map((m) => m.enrollmentId),
      );
    const studentByEnrollment = new Map((enrRows ?? []).map((e) => [e.id, e.student_id as string]));
    const assignments = okMoves
      .map((m) => ({ classId: m.newClassId, studentId: studentByEnrollment.get(m.enrollmentId) }))
      .filter((a): a is { classId: string; studentId: string } => !!a.studentId && !!a.classId);
    await notifyClassAssignment({
      tenantId: user.tenantId,
      actorId: user.id,
      assignments,
      type: "enrollment_transferred_in",
    });
  }

  revalidatePath("/timetable");
  return { results };
}

export type AttendanceEdit = { enrollmentId: string; days: string[] };

/**
 * 같은 반 등원 요일 편집(2일↔1일) 일괄 반영 — 반 이동이 아니라 **기존 enrollment의 attendance_days만 갱신**.
 * (반 이동처럼 종료+신규 생성/전입 플래그를 붙이면 초록 전입색·'반 이동' 사유가 잘못 붙는다.)
 * RLS(tenant_isolation)로 본 테넌트 enrollment만 갱신. days=[]는 전 요일 등원(분리 해제).
 * ⚠️ 셀 단위 편집이라 그 셀이 덮는 요일만 담긴다 — 한 반이 여러 셀에 걸치면 편집은 그 셀 요일 기준(v1 한계).
 */
export async function updateEnrollmentsAttendanceBatch(
  edits: AttendanceEdit[],
): Promise<{ error?: string; count?: number }> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  if (!(await canWriteTenant(user.systemRole, "classes"))) return { error: "반 배정 권한이 없습니다" };
  if (!Array.isArray(edits) || edits.length === 0) return { count: 0 };

  const supabase = await createClient();
  let count = 0;
  for (const e of edits) {
    const enrollmentId = String(e?.enrollmentId ?? "").trim();
    if (!enrollmentId) continue;
    const days = DAY_ORDER.filter((d) => (e.days ?? []).includes(d)); // 유효 요일코드만·요일순
    const { error } = await supabase
      .from("enrollments")
      .update({ attendance_days: days })
      .eq("id", enrollmentId);
    if (error) return { error: error.message, count };
    count++;
  }
  revalidatePath("/timetable");
  return { count };
}

export type UpdateEnrollmentDatesState = { ok?: boolean; error?: string } | undefined;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 수강 시작/종료일 직접 수정 (관리자 정정). owner(원장) 콘솔 권한 이상만(master).
 * enrollments는 시간 구간(temporal) 테이블이라 날짜 변경이 타임머신·시간표에 그대로 반영된다.
 * GiST EXCLUDE(enrollments_no_overlap = 같은 학생+같은 반 기간 겹침)에 걸리면 친절 메시지로 거부.
 */
export async function updateEnrollmentDates(
  _prev: UpdateEnrollmentDatesState,
  formData: FormData,
): Promise<UpdateEnrollmentDatesState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  // owner(원장) 콘솔 권한 이상만 — 날짜 정정은 수강 이력을 다시 쓰는 민감 작업이라 최상위로 제한.
  if ((await accessLevelTenant(user.systemRole, "owner")) !== "full") {
    return { error: "날짜 수정 권한이 없습니다 (원장 전용)" };
  }

  const enrollmentId = String(formData.get("enrollmentId") ?? "").trim();
  const field = String(formData.get("field") ?? "").trim(); // "start" | "end"
  const raw = String(formData.get("value") ?? "").trim();

  if (!enrollmentId) return { error: "수강 ID가 누락되었습니다" };
  if (field !== "start" && field !== "end") return { error: "잘못된 필드입니다" };

  const value = raw || null;
  if (field === "start" && !value) return { error: "시작일은 비울 수 없습니다" };
  if (value && !ISO_DATE.test(value)) return { error: "날짜 형식이 올바르지 않습니다" };

  const supabase = await createClient();
  const { data: current, error: fetchErr } = await supabase
    .from("enrollments")
    .select("start_date, end_date, student_id, class_id")
    .eq("id", enrollmentId)
    .single();
  if (fetchErr || !current) return { error: "수강 정보를 찾을 수 없습니다" };

  // 시작 ≤ 종료 검증(ISO 문자열은 사전식 비교가 곧 날짜 비교).
  const nextStart = field === "start" ? (value as string) : (current.start_date as string);
  const nextEnd = field === "end" ? value : (current.end_date as string | null);
  if (nextEnd && nextStart > nextEnd) {
    return { error: "시작일이 종료일보다 늦을 수 없습니다" };
  }

  // 종료를 비우면(null) 재원중 복귀 = withdrawal_reason도 해제.
  const patch: { start_date?: string; end_date?: string | null; withdrawal_reason?: string | null } =
    field === "start"
      ? { start_date: value as string }
      : value
        ? { end_date: value }
        : { end_date: null, withdrawal_reason: null };

  const { error } = await supabase.from("enrollments").update(patch).eq("id", enrollmentId);
  if (error) {
    if (
      error.message?.includes("enrollments_no_overlap") ||
      (error as { code?: string }).code === "23P01"
    ) {
      return { error: "같은 반에서 수강 기간이 겹칩니다" };
    }
    return { error: error.message };
  }

  revalidatePath("/timetable");
  revalidatePath(`/students/${current.student_id}`);
  revalidatePath(`/classes/${current.class_id}`);
  return { ok: true };
}
