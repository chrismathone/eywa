"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";
import { accessLevelTenant } from "@/lib/auth/perm-matrix";
import { kstToday } from "@/lib/date-kst";
import { isHexColor, readableTextColor } from "@/lib/color-utils";
import { logAction } from "@/features/audit/server/log";
import { notifyUsers } from "@/features/notifications/server/notify";
import { getClassroomAssignmentData } from "./queries";
import {
  ARCHIVE_REASON,
  CLOSE_TERM_REASON,
  closeClassEnrollments,
  reopenClassEnrollments,
} from "./enrollment-lifecycle";
import type { ClassroomAssignData } from "../lib/classroom-assign";

export type ClassFormState =
  | {
      error?: string;
      fieldErrors?: Record<string, string>;
      // 강사 시간 겹침 경고(부분허용) — 합반 등 의도된 겹침은 "무시하고 저장"으로 통과.
      teacherConflict?: string;
      ok?: true;
      redirectTo?: string;
      nonce?: number;
    }
  | undefined;

const DAY_LABEL_KR: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
  sat: "토",
  sun: "일",
};

type ScheduleInput = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
  // 교시별 오버라이드 — null이면 반 담임/기본 강의실 상속.
  teacherId: string | null;
  classroomId: string | null;
};

const DAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
// 레거시 기본 과목 — owner 설정의 과목 key와 합쳐 허용 집합을 만든다(설정에 추가한 과목도 저장 허용).
const LEGACY_SUBJECTS = ["math", "english", "korean", "science", "arts", "etc"] as const;

/** 저장 허용 과목 key 집합 = owner 설정 과목 ∪ 레거시 기본. (설정에 추가한 과목도 반에 저장 가능.) */
async function allowedSubjectSet(): Promise<ReadonlySet<string>> {
  const settings = await getTenantSettings();
  return new Set<string>([
    ...LEGACY_SUBJECTS,
    ...settings.operations.subjects.map((s) => s.key),
  ]);
}

function readForm(formData: FormData, allowedSubjects: ReadonlySet<string>) {
  const get = (k: string) => String(formData.get(k) ?? "").trim();
  const subject = get("subject") || "math";
  const bgRaw = get("bgColor");
  // 반 헤더색(시간표 통합뷰 소비) — 유효 hex만, 없으면 null=과목색 폴백. 글자색은 휘도로 자동.
  const bgColor = isHexColor(bgRaw) ? bgRaw : null;
  return {
    className: get("className"),
    // 허용 집합(설정 과목 ∪ 레거시)에 없는 값만 'etc'로 강등(쓰레기 입력 가드).
    subject: allowedSubjects.has(subject) ? subject : "etc",
    teacherId: get("teacherId") || null,
    classroomId: get("classroomId") || null,
    notes: get("notes") || null,
    bgColor,
    textColor: bgColor ? readableTextColor(bgColor) || null : null,
    schedules: parseSchedules(formData),
  };
}

function parseSchedules(formData: FormData): ScheduleInput[] {
  // 클릭그리드 제출: schedule_{day,start,end,teacher,classroom}_${i}. 요일×교시라 슬롯이 많을 수 있어 상한 80.
  const result: ScheduleInput[] = [];
  for (let i = 0; i < 80; i++) {
    const dayOfWeek = String(formData.get(`schedule_day_${i}`) ?? "").trim();
    const startTime = String(formData.get(`schedule_start_${i}`) ?? "").trim();
    const endTime = String(formData.get(`schedule_end_${i}`) ?? "").trim();
    if (!dayOfWeek || !startTime || !endTime) continue;
    if (!DAYS.includes(dayOfWeek as (typeof DAYS)[number])) continue;
    const teacherId = String(formData.get(`schedule_teacher_${i}`) ?? "").trim() || null;
    const classroomId = String(formData.get(`schedule_classroom_${i}`) ?? "").trim() || null;
    result.push({ dayOfWeek, startTime, endTime, teacherId, classroomId });
  }
  return result;
}

function validate(input: ReturnType<typeof readForm>): Record<string, string> | null {
  const errors: Record<string, string> = {};
  if (!input.className) errors.className = "반 이름은 필수입니다";
  if (!input.subject) errors.subject = "과목을 선택해주세요";
  for (const s of input.schedules) {
    if (s.startTime >= s.endTime) {
      errors.schedules = "시작 시간이 종료 시간보다 빠르야 합니다";
      break;
    }
  }
  return Object.keys(errors).length > 0 ? errors : null;
}

export async function createClass(
  _prev: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  const { user, error: gateError } = await requireClassWrite();
  if (gateError || !user) return { error: gateError };

  const allowed = await allowedSubjectSet();
  const input = readForm(formData, allowed);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();

  // 충돌 감지: 같은 강의실 + 요일 + 시간 겹침
  if (input.classroomId && input.schedules.length > 0) {
    const conflict = await detectScheduleConflict(
      supabase,
      input.classroomId,
      input.schedules,
    );
    if (conflict) {
      return { error: `강의실 스케줄 충돌: ${conflict}` };
    }
  }

  // 강사 시간 겹침(부분허용) — 같은 강사 같은 시간대면 경고. "무시하고 저장"(ignoreTeacherConflict=1)이면 통과(합반 등).
  if (input.schedules.length > 0 && formData.get("ignoreTeacherConflict") !== "1") {
    const tConflict = await detectTeacherConflict(supabase, input.schedules, input.teacherId);
    if (tConflict) return { teacherConflict: tConflict };
  }

  const { data, error } = await supabase
    .from("classes")
    .insert({
      tenant_id: user.tenantId,
      class_name: input.className,
      subject: input.subject,
      teacher_id: input.teacherId,
      classroom_id: input.classroomId,
      // 새 반은 **항상 활성**. 끄는 것은 반 상세의 '반 폐지'뿐이다(2026-07-21) — 폐지만이 그 반 활성
      // 수강까지 함께 종료해 학생목록·학생상세와 어긋나지 않는다. 폼에서 끄는 문은 폐지했다.
      is_active: true,
      notes: input.notes,
      bg_color: input.bgColor,
      text_color: input.textColor,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "반 생성 실패" };

  if (input.schedules.length > 0) {
    // valid_from은 NOT NULL(기본값 없음) — 반드시 채워야 insert 성공(없으면 전 스케줄 저장이 조용히 실패).
    const validFrom = kstToday();
    const rows = input.schedules.map((s) => ({
      tenant_id: user.tenantId,
      class_id: data.id,
      day_of_week: s.dayOfWeek,
      start_time: s.startTime,
      end_time: s.endTime,
      valid_from: validFrom,
      teacher_id: s.teacherId,
      classroom_id: s.classroomId,
    }));
    const { error: schedErr } = await supabase.from("class_schedules").insert(rows);
    if (schedErr) {
      // 반은 생성됐지만 스케줄 실패 - 반 삭제 후 에러 반환
      await supabase.from("classes").delete().eq("id", data.id);
      return { error: `스케줄 저장 실패: ${schedErr.message}` };
    }
  }

  revalidatePath("/classes");
  revalidatePath("/timetable");
  // redirect 대신 결과 반환 — 클라가 성공 확정(nonce) 후 초안 삭제·동시편집 신호·이동(B-2).
  // (redirect()면 NEXT_REDIRECT throw로 폼의 nonce 효과가 안 돌아 'class:new' 초안이 안 비워진다.)
  return { ok: true, redirectTo: `/classes/${data.id}`, nonce: Date.now() };
}

export async function updateClass(
  _prev: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  const { user, error: gateError } = await requireClassWrite();
  if (gateError || !user) return { error: gateError };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "반 ID가 누락되었습니다" };

  const allowed = await allowedSubjectSet();
  const input = readForm(formData, allowed);
  const fieldErrors = validate(input);
  if (fieldErrors) return { fieldErrors };

  const supabase = await createClient();

  // 강의실 충돌 감지 (자기 자신 제외)
  if (input.classroomId && input.schedules.length > 0) {
    const conflict = await detectScheduleConflict(
      supabase,
      input.classroomId,
      input.schedules,
      id,
    );
    if (conflict) {
      return { error: `강의실 스케줄 충돌: ${conflict}` };
    }
  }

  // 강사 시간 겹침(부분허용) — 자기 자신(id) 제외. "무시하고 저장"이면 통과(합반 등).
  if (input.schedules.length > 0 && formData.get("ignoreTeacherConflict") !== "1") {
    const tConflict = await detectTeacherConflict(supabase, input.schedules, input.teacherId, id);
    if (tConflict) return { teacherConflict: tConflict };
  }

  const { error } = await supabase
    .from("classes")
    .update({
      class_name: input.className,
      subject: input.subject,
      teacher_id: input.teacherId,
      classroom_id: input.classroomId,
      // ⚠️ **is_active를 여기서 건드리지 않는다**(2026-07-21). 예전엔 폼 체크박스가 이 값을 썼는데,
      // 폐지 버튼과 달리 **그 반 활성 수강을 종료하지 않아** 시간표·출석부에선 사라지고 학생목록엔
      // "수강중"으로 남는 사각지대가 생겼다. 폐지/재운영은 archiveClass 단일 경로.
      notes: input.notes,
      bg_color: input.bgColor,
      text_color: input.textColor,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  // 기존 스케줄 모두 삭제 후 재삽입 (간단한 동기화)
  await supabase.from("class_schedules").delete().eq("class_id", id);

  if (input.schedules.length > 0) {
    // valid_from은 NOT NULL(기본값 없음) — 반드시 채워야 insert 성공(없으면 delete만 되고 재삽입이 실패).
    const validFrom = kstToday();
    const rows = input.schedules.map((s) => ({
      tenant_id: user.tenantId,
      class_id: id,
      day_of_week: s.dayOfWeek,
      start_time: s.startTime,
      end_time: s.endTime,
      valid_from: validFrom,
      teacher_id: s.teacherId,
      classroom_id: s.classroomId,
    }));
    const { error: schedErr } = await supabase.from("class_schedules").insert(rows);
    if (schedErr) return { error: `스케줄 저장 실패: ${schedErr.message}` };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  // redirect 대신 결과 반환 — 클라가 성공 확정 후 동시편집 신호(publish) → 이동(B-2).
  return { ok: true, redirectTo: `/classes/${id}`, nonce: Date.now() };
}

export type ArchiveClassState = { error?: string } | undefined;

/**
 * 반 폐지/재운영 토글.
 * 폐지 = is_active=false + **그 반 활성 수강을 오늘로 종료**(reason='반 폐지'). 재운영 = 되돌림.
 * ⚠️ 학생 상태(students.status)는 건드리지 않는다 — 수강이 0이 된 학생은 재원인 채로 남아
 * 대시보드 '반 미배정 재원생'에서 재배정한다. 근거는 enrollment-lifecycle.ts 주석 참조.
 */
export async function archiveClass(
  _prev: ArchiveClassState,
  formData: FormData,
): Promise<ArchiveClassState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };
  const clsLvl = await accessLevelTenant(user.systemRole, "classes");
  if (clsLvl !== "full" && clsLvl !== "scoped") return { error: "반 관리 권한이 없습니다" };

  const id = String(formData.get("id") ?? "").trim();
  const next = String(formData.get("isActive") ?? "false") === "true";
  if (!id) return { error: "반 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: klass } = await supabase
    .from("classes")
    .select("class_name")
    .eq("id", id)
    .maybeSingle();

  const { error } = await supabase
    .from("classes")
    .update({ is_active: next })
    .eq("id", id);

  if (error) return { error: error.message };

  // 수강 동기화는 classes 갱신이 성공한 뒤 — 실패해도 반 상태와 수강이 어긋나지 않게 순서를 고정.
  const sync = next
    ? await reopenClassEnrollments(supabase, id, ARCHIVE_REASON)
    : await closeClassEnrollments(supabase, id, kstToday(), ARCHIVE_REASON);
  if (sync.error) return { error: sync.error };

  await logAction({
    action: next ? "class_unarchive" : "class_archive",
    targetType: "class",
    targetLabel: klass?.class_name,
    metadata: { classId: id, affectedStudents: sync.studentIds.length },
  });

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  revalidatePath("/students");
  revalidatePath("/");
  return undefined;
}

// ────────────────────── 종강 / 재개강 (운영 종료일) ──────────────────────
// 폐지(archiveClass, is_active)와 별개: 종강은 closed_at에 종료일을 찍고 is_active=true를 유지.
// → 타임머신에서 종강일 이전 주엔 표시(수강이력 보존), 이후 주에선 숨김(폐지는 전체 숨김).
export type ClassTermState = { error?: string } | undefined;

/** 종강 — closed_at에 종료일 기록(기본 오늘). */
export async function endClassTerm(_prev: ClassTermState, formData: FormData): Promise<ClassTermState> {
  const { user, error } = await requireClassWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  const date = String(formData.get("date") ?? "").trim() || kstToday();
  if (!id) return { error: "반 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: klass } = await supabase.from("classes").select("class_name").eq("id", id).single();
  const { error: updErr } = await supabase.from("classes").update({ closed_at: date }).eq("id", id);
  if (updErr) return { error: updErr.message };

  // 종강 = 그 반 활성 수강도 종강일로 종료(reason='종강'). 종강일 이전 주 시간표엔 그대로 남는다
  // (enrollment가 그 시점엔 활성이었으므로) → 수강이력 보존이라는 종강의 성격과 일치.
  const sync = await closeClassEnrollments(supabase, id, date, CLOSE_TERM_REASON);
  if (sync.error) return { error: sync.error };

  await logAction({
    action: "class_end_term",
    targetType: "class",
    targetLabel: klass?.class_name,
    metadata: { classId: id, closedAt: date, affectedStudents: sync.studentIds.length },
  });
  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  revalidatePath("/students");
  revalidatePath("/");
  return undefined;
}

/** 재개강 — closed_at 비움(다시 운영). */
export async function reopenClassTerm(_prev: ClassTermState, formData: FormData): Promise<ClassTermState> {
  const { user, error } = await requireClassWrite();
  if (error || !user) return { error };

  const id = String(formData.get("id") ?? "").trim();
  if (!id) return { error: "반 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: klass } = await supabase.from("classes").select("class_name").eq("id", id).single();
  const { error: updErr } = await supabase.from("classes").update({ closed_at: null }).eq("id", id);
  if (updErr) return { error: updErr.message };

  // 종강이 종료시킨 수강만 되살린다(그 전에 수동 종료·반이동으로 끝난 수강은 그대로).
  const sync = await reopenClassEnrollments(supabase, id, CLOSE_TERM_REASON);
  if (sync.error) return { error: sync.error };

  await logAction({
    action: "class_reopen_term",
    targetType: "class",
    targetLabel: klass?.class_name,
    metadata: { classId: id, affectedStudents: sync.studentIds.length },
  });
  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  revalidatePath("/students");
  revalidatePath("/");
  return undefined;
}

// ────────────────────── 강사 인수인계(담임 교체 예약) ──────────────────────
// ijw TeacherHandover 경량 이식: 예약(scheduleHandover) → 배너 → 적용(applyHandover)/취소(cancelHandover).
// ⚠️ ijw의 enrollment eager-split·배치 롤백·적용일 자동적용은 미이식(데모 과중). 적용은 수동(배너 버튼).
export type HandoverState = { error?: string; ok?: boolean } | undefined;

async function requireClassWrite() {
  const user = await getCurrentUser();
  if (!user) return { user: null, error: "로그인이 필요합니다" };
  const lvl = await accessLevelTenant(user.systemRole, "classes");
  if (lvl !== "full" && lvl !== "scoped") return { user: null, error: "반 관리 권한이 없습니다" };
  return { user, error: undefined as string | undefined };
}

/**
 * 인계 대상이 이 학원의 활성 강사/실장/원장인지 검증 — 예약(schedule)·적용(apply) 공통.
 * RLS가 users SELECT를 자기 테넌트로 제한 → 타 테넌트 id는 null로 거부.
 * ⚠️ apply에서도 반드시 재검증할 것 — 예약~적용 사이에 대상이 퇴사/역할변경되면 schedule 검증이 무의미해진다.
 */
async function isAssignableTeacher(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("users")
    .select("system_role, status")
    .eq("id", userId)
    .maybeSingle();
  return (
    !!data && ["teacher", "manager", "master"].includes(data.system_role) && data.status === "active"
  );
}

/** 강사 인수인계 예약 — 예정 강사·적용일·사유를 classes에 저장(아직 teacher_id 미변경). */
export async function scheduleHandover(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const { user, error } = await requireClassWrite();
  if (error || !user) return { error };

  const classId = String(formData.get("classId") ?? "").trim();
  const newTeacherId = String(formData.get("newTeacherId") ?? "").trim();
  const effectiveDate = String(formData.get("effectiveDate") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim() || null;
  if (!classId) return { error: "반 ID가 누락되었습니다" };
  if (!newTeacherId) return { error: "인계받을 강사를 선택해주세요" };
  if (!effectiveDate) return { error: "적용일을 입력해주세요" };

  const supabase = await createClient();
  const { data: klass } = await supabase
    .from("classes")
    .select("class_name, teacher_id")
    .eq("id", classId)
    .single();
  if (!klass) return { error: "반을 찾을 수 없습니다" };
  if (klass.teacher_id === newTeacherId) return { error: "현재 담임과 동일한 강사입니다" };

  // 인계 대상이 이 학원의 활성 강사/실장/원장인지 검증 — UI는 검색으로 전체 강사를 노출하므로
  // 서버에서도 유효성을 못박는다(변조 payload·타 테넌트 id 방어).
  if (!(await isAssignableTeacher(supabase, newTeacherId))) {
    return { error: "유효한 강사가 아닙니다" };
  }

  const { error: updErr } = await supabase
    .from("classes")
    .update({
      pending_teacher_id: newTeacherId,
      pending_teacher_date: effectiveDate,
      pending_teacher_reason: reason,
    })
    .eq("id", classId);
  if (updErr) return { error: updErr.message };

  await logAction({
    action: "class_handover_schedule",
    targetType: "class",
    targetLabel: klass.class_name,
    metadata: { newTeacherId, effectiveDate },
  });
  // 새 담임으로 예약된 강사에게 알림 — best-effort(실패해도 예약은 성공).
  await notifyUsers([
    {
      tenantId: user.tenantId,
      recipientId: newTeacherId,
      type: "teacher_handover",
      title: "강사 인수인계 예약",
      body: `${klass.class_name} 반의 새 담임으로 예약되었습니다 (적용일 ${effectiveDate}).`,
      link: `/classes/${classId}`,
      actorId: user.id,
    },
  ]);
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
  revalidatePath("/timetable");
  return { ok: true };
}

/** 인수인계 예약 취소 — 예정 필드 비움(teacher_id 불변). */
export async function cancelHandover(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const { user, error } = await requireClassWrite();
  if (error || !user) return { error };

  const classId = String(formData.get("classId") ?? "").trim();
  if (!classId) return { error: "반 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error: updErr } = await supabase
    .from("classes")
    .update({ pending_teacher_id: null, pending_teacher_date: null, pending_teacher_reason: null })
    .eq("id", classId);
  if (updErr) return { error: updErr.message };

  await logAction({ action: "class_handover_cancel", targetType: "class", metadata: { classId } });
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
  revalidatePath("/timetable");
  return { ok: true };
}

/** 인수인계 적용 — teacher_id ← pending_teacher_id로 교체하고 예정 필드 비움. */
export async function applyHandover(_prev: HandoverState, formData: FormData): Promise<HandoverState> {
  const { user, error } = await requireClassWrite();
  if (error || !user) return { error };

  const classId = String(formData.get("classId") ?? "").trim();
  if (!classId) return { error: "반 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { data: klass } = await supabase
    .from("classes")
    .select("class_name, pending_teacher_id")
    .eq("id", classId)
    .single();
  if (!klass) return { error: "반을 찾을 수 없습니다" };
  if (!klass.pending_teacher_id) return { error: "예약된 인수인계가 없습니다" };

  // ⚠️ 예약 시점 검증만으론 부족 — 예약~적용 사이에 대상이 퇴사/역할변경됐을 수 있어 적용 직전 재검증.
  // (FK onDelete:set null이라 하드삭제는 위 null 가드가 잡지만 status/role 변경은 안 잡힘.)
  if (!(await isAssignableTeacher(supabase, klass.pending_teacher_id))) {
    return { error: "예정된 강사가 더 이상 유효하지 않습니다(퇴사·역할 변경). 인수인계를 다시 예약해주세요." };
  }

  const { error: updErr } = await supabase
    .from("classes")
    .update({
      teacher_id: klass.pending_teacher_id,
      pending_teacher_id: null,
      pending_teacher_date: null,
      pending_teacher_reason: null,
    })
    .eq("id", classId);
  if (updErr) return { error: updErr.message };

  await logAction({
    action: "class_handover_apply",
    targetType: "class",
    targetLabel: klass.class_name,
    metadata: { newTeacherId: klass.pending_teacher_id },
  });
  revalidatePath(`/classes/${classId}`);
  revalidatePath("/classes");
  revalidatePath("/timetable");
  return { ok: true };
}

// ────────────────────── 강의실 자동배정 ──────────────────────
// ijw ClassroomAssignment 경량 이식: 미리보기(loadClassroomAssignmentData + 순수 알고리즘) → 적용.
// ⚠️ 데이터는 클라가 미리보기 열 때만 지연 로드(페이지 로드 비용 0). 적용은 반 기본 강의실(classes.classroom_id)만.

/** 자동배정 미리보기 데이터 지연 로드 — 반 쓰기 권한자만(읽기 전용엔 도구 비노출). */
export async function loadClassroomAssignmentData(): Promise<{
  data?: ClassroomAssignData;
  error?: string;
}> {
  const { user, error } = await requireClassWrite();
  if (error || !user) return { error };
  return { data: await getClassroomAssignmentData() };
}

export type ApplyAssignState = { error?: string; ok?: boolean; applied?: number } | undefined;

/** 자동배정 적용 — 변경분만 classes.classroom_id 업데이트(강의실별 묶어 한 번씩). */
export async function applyClassroomAssignments(
  _prev: ApplyAssignState,
  formData: FormData,
): Promise<ApplyAssignState> {
  const { user, error } = await requireClassWrite();
  if (error || !user) return { error };

  let parsed: { classId: string; roomId: string }[];
  try {
    parsed = JSON.parse(String(formData.get("assignments") ?? "[]"));
  } catch {
    return { error: "배정 데이터 파싱 실패" };
  }
  if (!Array.isArray(parsed) || parsed.length === 0) return { error: "적용할 변경이 없습니다" };

  // 강의실별로 묶어 update 횟수 최소화(데모 규모 ≤5 강의실 → ≤5 update).
  const byRoom = new Map<string, string[]>();
  for (const a of parsed) {
    if (!a?.classId || !a?.roomId) continue;
    const arr = byRoom.get(a.roomId) ?? [];
    arr.push(a.classId);
    byRoom.set(a.roomId, arr);
  }
  if (byRoom.size === 0) return { error: "적용할 변경이 없습니다" };

  const supabase = await createClient();
  let applied = 0;
  for (const [roomId, ids] of byRoom) {
    const { error: updErr } = await supabase
      .from("classes")
      .update({ classroom_id: roomId })
      .in("id", ids);
    if (updErr) return { error: updErr.message };
    applied += ids.length;
  }

  await logAction({
    action: "classroom_auto_assign",
    targetType: "class",
    metadata: { applied, rooms: byRoom.size },
  });
  revalidatePath("/classes");
  revalidatePath("/timetable");
  return { ok: true, applied };
}

/**
 * 강의실의 기존 스케줄과 새 스케줄 시간이 겹치는지 확인.
 * 같은 반(excludeClassId)은 제외 (수정 시 자기 자신).
 */
/**
 * 강사 시간 겹침 감지 — 같은 강사(실효 강사 = 슬롯 override ?? 반 담임)가 같은 요일·시간대에
 * 다른 활성 반과 겹치는지. 폐지(is_active=false)·종강(closed_at<오늘)·만료(valid_to<오늘) 반은 제외.
 * 자유입력 슬롯 라벨(slot_teacher_label)은 FK가 아니라 검사 불가 → teacher_id로 풀리는 것만.
 * 하드 차단이 아니라 "경고"용(부분허용) — 합반 등 의도된 겹침은 호출부에서 무시 가능.
 */
async function detectTeacherConflict(
  supabase: Awaited<ReturnType<typeof createClient>>,
  candidates: ScheduleInput[],
  classDefaultTeacherId: string | null,
  excludeClassId?: string,
): Promise<string | null> {
  // 실효 강사가 있는 후보 슬롯만(강사 미지정 슬롯은 검사 불가).
  const cands = candidates
    .map((s) => ({ day: s.dayOfWeek, start: s.startTime, end: s.endTime, teacher: s.teacherId ?? classDefaultTeacherId }))
    .filter((s): s is { day: string; start: string; end: string; teacher: string } => !!s.teacher);
  if (cands.length === 0) return null;

  const days = [...new Set(cands.map((c) => c.day))];
  const today = kstToday();

  // 같은 요일의 기존 스케줄(활성 반만, !inner + is_active). 종강·만료는 JS에서 추가 제외.
  const { data } = await supabase
    .from("class_schedules")
    .select(
      "class_id, day_of_week, start_time, end_time, teacher_id, valid_to, class:class_id!inner ( class_name, teacher_id, is_active, closed_at )",
    )
    .in("day_of_week", days)
    .eq("class.is_active", true);
  if (!data) return null;

  for (const c of cands) {
    for (const ex of data) {
      if (excludeClassId && ex.class_id === excludeClassId) continue; // 자기 자신(수정 시)
      if (ex.day_of_week !== c.day) continue;
      const k = (Array.isArray(ex.class) ? ex.class[0] : ex.class) as
        | { class_name?: string; teacher_id?: string | null; closed_at?: string | null }
        | undefined;
      if (!k) continue;
      if (ex.valid_to && String(ex.valid_to).slice(0, 10) < today) continue; // 만료 스케줄 제외
      if (k.closed_at && String(k.closed_at).slice(0, 10) < today) continue; // 종강 반 제외
      const exTeacher = (ex.teacher_id as string | null) ?? k.teacher_id ?? null;
      if (!exTeacher || exTeacher !== c.teacher) continue; // 같은 강사만
      const exStart = String(ex.start_time).slice(0, 5);
      const exEnd = String(ex.end_time).slice(0, 5);
      if (c.start < exEnd && c.end > exStart) {
        const { data: u } = await supabase
          .from("users")
          .select("display_name")
          .eq("id", exTeacher)
          .maybeSingle();
        const tname = u?.display_name ?? "해당 강사";
        return `${tname} · ${DAY_LABEL_KR[c.day] ?? c.day}요일 ${exStart}~${exEnd} (${k.class_name ?? "기존 반"})`;
      }
    }
  }
  return null;
}

async function detectScheduleConflict(
  supabase: Awaited<ReturnType<typeof createClient>>,
  classroomId: string,
  candidates: ScheduleInput[],
  excludeClassId?: string,
): Promise<string | null> {
  let qb = supabase
    .from("class_schedules")
    .select("class_id, day_of_week, start_time, end_time, class:class_id ( class_name )")
    .eq("class_id", classroomId);

  // 같은 강의실에 있는 모든 클래스 스케줄 조회
  let q2 = supabase
    .from("classes")
    .select("id")
    .eq("classroom_id", classroomId);
  if (excludeClassId) q2 = q2.neq("id", excludeClassId);
  const { data: clsList } = await q2;
  if (!clsList || clsList.length === 0) return null;

  qb = supabase
    .from("class_schedules")
    .select("class_id, day_of_week, start_time, end_time, class:class_id ( class_name )")
    .in("class_id", clsList.map((c) => c.id));

  const { data } = await qb;
  if (!data || data.length === 0) return null;

  for (const c of candidates) {
    for (const existing of data) {
      if (existing.day_of_week !== c.dayOfWeek) continue;
      const exStart = String(existing.start_time).slice(0, 5);
      const exEnd = String(existing.end_time).slice(0, 5);
      // 시간 겹침
      if (c.startTime < exEnd && c.endTime > exStart) {
        const klass = (Array.isArray(existing.class) ? existing.class[0] : existing.class) as
          | { class_name?: string }
          | undefined;
        const cn = klass?.class_name ?? "기존 반";
        const dayLabel: Record<string, string> = {
          mon: "월",
          tue: "화",
          wed: "수",
          thu: "목",
          fri: "금",
          sat: "토",
          sun: "일",
        };
        return `${dayLabel[c.dayOfWeek] ?? c.dayOfWeek}요일 ${exStart}~${exEnd} (${cn})`;
      }
    }
  }
  return null;
}
