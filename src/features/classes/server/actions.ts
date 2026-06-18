"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth/current-user";
import { createClient } from "@/lib/supabase/server";
import { getTenantSettings } from "@/features/owner/server/queries";

export type ClassFormState =
  | { error?: string; fieldErrors?: Record<string, string> }
  | undefined;

type ScheduleInput = {
  dayOfWeek: string;
  startTime: string;
  endTime: string;
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
  return {
    className: get("className"),
    // 허용 집합(설정 과목 ∪ 레거시)에 없는 값만 'etc'로 강등(쓰레기 입력 가드).
    subject: allowedSubjects.has(subject) ? subject : "etc",
    teacherId: get("teacherId") || null,
    classroomId: get("classroomId") || null,
    notes: get("notes") || null,
    isActive: get("isActive") !== "false",
    schedules: parseSchedules(formData),
  };
}

function parseSchedules(formData: FormData): ScheduleInput[] {
  // schedules are submitted as `schedule_day_${i}`, `schedule_start_${i}`, `schedule_end_${i}`
  const result: ScheduleInput[] = [];
  for (let i = 0; i < 20; i++) {
    const dayOfWeek = String(formData.get(`schedule_day_${i}`) ?? "").trim();
    const startTime = String(formData.get(`schedule_start_${i}`) ?? "").trim();
    const endTime = String(formData.get(`schedule_end_${i}`) ?? "").trim();
    if (!dayOfWeek || !startTime || !endTime) continue;
    if (!DAYS.includes(dayOfWeek as (typeof DAYS)[number])) continue;
    result.push({ dayOfWeek, startTime, endTime });
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
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

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

  const { data, error } = await supabase
    .from("classes")
    .insert({
      tenant_id: user.tenantId,
      class_name: input.className,
      subject: input.subject,
      teacher_id: input.teacherId,
      classroom_id: input.classroomId,
      is_active: input.isActive,
      notes: input.notes,
    })
    .select("id")
    .single();

  if (error || !data) return { error: error?.message ?? "반 생성 실패" };

  if (input.schedules.length > 0) {
    const rows = input.schedules.map((s) => ({
      tenant_id: user.tenantId,
      class_id: data.id,
      day_of_week: s.dayOfWeek,
      start_time: s.startTime,
      end_time: s.endTime,
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
  redirect(`/classes/${data.id}`);
}

export async function updateClass(
  _prev: ClassFormState,
  formData: FormData,
): Promise<ClassFormState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

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

  const { error } = await supabase
    .from("classes")
    .update({
      class_name: input.className,
      subject: input.subject,
      teacher_id: input.teacherId,
      classroom_id: input.classroomId,
      is_active: input.isActive,
      notes: input.notes,
    })
    .eq("id", id);

  if (error) return { error: error.message };

  // 기존 스케줄 모두 삭제 후 재삽입 (간단한 동기화)
  await supabase.from("class_schedules").delete().eq("class_id", id);

  if (input.schedules.length > 0) {
    const rows = input.schedules.map((s) => ({
      tenant_id: user.tenantId,
      class_id: id,
      day_of_week: s.dayOfWeek,
      start_time: s.startTime,
      end_time: s.endTime,
    }));
    const { error: schedErr } = await supabase.from("class_schedules").insert(rows);
    if (schedErr) return { error: `스케줄 저장 실패: ${schedErr.message}` };
  }

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  redirect(`/classes/${id}`);
}

export type ArchiveClassState = { error?: string } | undefined;

export async function archiveClass(
  _prev: ArchiveClassState,
  formData: FormData,
): Promise<ArchiveClassState> {
  const user = await getCurrentUser();
  if (!user) return { error: "로그인이 필요합니다" };

  const id = String(formData.get("id") ?? "").trim();
  const next = String(formData.get("isActive") ?? "false") === "true";
  if (!id) return { error: "반 ID가 누락되었습니다" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("classes")
    .update({ is_active: next })
    .eq("id", id);

  if (error) return { error: error.message };

  revalidatePath("/classes");
  revalidatePath(`/classes/${id}`);
  revalidatePath("/timetable");
  return undefined;
}

/**
 * 강의실의 기존 스케줄과 새 스케줄 시간이 겹치는지 확인.
 * 같은 반(excludeClassId)은 제외 (수정 시 자기 자신).
 */
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
