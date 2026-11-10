import "server-only";
import type { createAdminClient } from "@/lib/supabase/admin";
import { isEnrollmentActiveOn, enrollmentAttendsOnDay } from "@/features/enrollments/eligibility";
import { effectiveAttendanceRecords } from "@/features/attendance/effective-records";
import { reportError } from "@/lib/observability/report-error";
import { dowKeyOf } from "../lib/week";
import { rosterFormOf, type RosterForm } from "../lib/roster-form";
import {
  carryRoster,
  planCarryMarks,
  type CarryPatch,
  type DayAttendance,
  type PastMarkRow,
  type TargetMarkRow,
} from "../lib/carry-marks";
import { explainDbError } from "@/lib/supabase/db-error";

/**
 * JJ 폼 이어받기의 **IO 쪽** — 규칙(무엇을 채우나)은 순수 모듈
 * [`lib/carry-marks.ts`](../lib/carry-marks.ts)가 갖고, 여기서는 읽고 쓴다.
 *
 * '내용 복사 (지난 수업)'가 이 함수를 함께 부른다(직원 요청 2026-08-19). 계획 복사와 **같은 버튼**인 이유:
 * 강사가 이미 그 버튼으로 "지난 수업 것 가져오기"를 하고 있어서, 칸만 늘어난 것으로 읽힌다.
 *
 * 🔴 **JJ(집중자율수업실) 교시에서만** 돈다 — 판정은 슬롯 라벨 하나(`rosterFormOf`)이고 반 이름·강의실로
 *    추측하지 않는다(roster-form과 같은 규약). 기본 폼에는 '시험 점수'뿐인데 그건 그 수업의 결과라
 *    이어받으면 없던 점수를 지어내게 된다.
 * ⚠️ 이 함수는 **본 복사를 절대 막지 않는다** — 실패하면 사유만 돌려주고 계획 복사는 그대로 성공이다
 *    (계측은 남긴다: 조용히 접으면 "왜 안 채워지지"를 아무도 모른다, [[#89]]).
 * ⚠️ 0206a(듣기 레벨·누적 단어수 컬럼) 미적용 배포에서도 죽지 않는다 — 컬럼 부재를 알아보고 `pending`으로
 *    접는다([[#95]] 배포는 옛 스키마·새 스키마 둘 다에서 돌아야 한다).
 */

type Admin = ReturnType<typeof createAdminClient>;

/** 지난 기록을 찾는 창 — 계획 복사(0209a)와 같은 56일. 더 옛 값은 오늘의 근거로 쓰기엔 낡았다. */
const LOOKBACK_DAYS = 56;

/**
 * 한 번에 받는 지난 기록 상한. 내림차순(최신 먼저)이라 상한에 걸려 잘리는 것은 **가장 오래된 쪽**이고,
 * 그건 "한참 전에 한 번 적힌 값"이라 잃어도 오늘 값의 근거로는 손해가 적다(B2 — 무페이징 select 금지).
 */
const PAST_ROWS_CAP = 1000;

export type CarryMarksOutcome = {
  /** 그 교시의 폼 — `default`면 아무 일도 하지 않았다는 뜻이다. */
  form: RosterForm;
  /** 실제로 저장된 패치(호출부가 화면 상태에 머지한다 — refresh만으론 클라 state가 안 바뀐다). */
  patches: CarryPatch[];
  /** 0206a 미적용 — 칸이 아직 없어 못 채웠다. */
  pending: boolean;
  /** 실패 사유(한글). 있으면 호출부가 알리되 본 복사는 성공으로 둔다. */
  error: string | null;
};

const NOTHING = (form: RosterForm): CarryMarksOutcome => ({
  form,
  patches: [],
  pending: false,
  error: null,
});

/** PostgREST가 "그 컬럼 없다"고 알리는 방식 — 스키마 캐시(PGRST204)와 Postgres(42703). */
function isMissingColumn(err: { code?: string; message?: string } | null): boolean {
  if (!err) return false;
  if (err.code === "PGRST204" || err.code === "42703") return true;
  const msg = err.message ?? "";
  return /listening_level|memorized_words/.test(msg) && /column|schema cache/i.test(msg);
}

export async function carrySelfStudyMarks(args: {
  admin: Admin;
  tenantId: string;
  classId: string;
  /** 채운 칸에 남길 작성자. 🔵 공개 PIN 경로는 null — 로그인 없이 적은 것을 이름 붙이지 않는다. */
  actorId: string | null;
  /** 대상 날짜(YYYY-MM-DD) */
  planDate: string;
  /** 대상 교시(HH:MM) */
  slotStart: string;
}): Promise<CarryMarksOutcome> {
  try {
    const form = await slotFormOn(args);
    if (form !== "selfStudy") return NOTHING(form);

    // 서로 독립 — 함께 받는다(B4).
    const [roster, past, target] = await Promise.all([
      eligibleRoster(args),
      pastMarks(args),
      targetMarks(args),
    ]);
    if (past.pending) return { form, patches: [], pending: true, error: null };
    if (roster.length === 0) return NOTHING(form);

    const patches = planCarryMarks({ roster, past: past.rows, target: target.rows });
    if (patches.length === 0) return NOTHING(form);

    const now = new Date().toISOString();
    const { error } = await args.admin.from("class_sheet_student_marks").upsert(
      patches.map((p) => ({
        tenant_id: args.tenantId,
        class_id: args.classId,
        student_id: p.studentId,
        mark_date: args.planDate,
        slot_start: args.slotStart,
        // 🔴 status·progress_note는 **payload에 넣지 않는다** — PostgREST는 보낸 컬럼만 SET하므로
        //    빼두면 기존 태도·특이사항이 그대로 살아 있다(넣으면 null로 덮어써 기록이 사라진다).
        listening_level: p.listeningLevel,
        memorized_words: p.memorizedWords,
        updated_by: args.actorId,
        updated_at: now,
      })),
      { onConflict: "tenant_id,class_id,student_id,mark_date,slot_start" },
    );
    if (error) {
      if (isMissingColumn(error)) return { form, patches: [], pending: true, error: null };
      reportError(error, { scope: "ecs.carrySelfStudyMarks", classId: args.classId, planDate: args.planDate });
      return {
        form,
        patches: [],
        pending: false,
        error: explainDbError(error, { scope: "class-sheets.carry-marks.carrySelfStudyMarks", fallback: "듣기 레벨·누적 암기 단어수는 채우지 못했습니다 — 잠시 후 다시 시도해 주세요" }).message,
      };
    }
    return { form, patches, pending: false, error: null };
  } catch (e) {
    reportError(e, { scope: "ecs.carrySelfStudyMarks", classId: args.classId, planDate: args.planDate });
    return {
      form: "default",
      patches: [],
      pending: false,
      error: "듣기 레벨·누적 암기 단어수는 채우지 못했습니다(잠시 후 다시 시도해 주세요)",
    };
  }
}

/**
 * 그 (반, 날짜, 교시)의 폼 — 슬롯 라벨로 판정한다.
 * ⚠️ `class_schedules`는 **운영 이력을 함께 담는다**([[#88]]) — 그 날짜에 유효한 행만 본다. 안 그러면
 *    옛 배치(그때는 JJ였던 교시)로 판정이 뒤집힌다.
 * 🔑 같은 시각에 자리와 강사 수업이 겹치면 **수업이 이긴다**(`ecs_seat_kind_at`·grid.ts와 같은 규약) —
 *    자리로 판정되면 실수업이 화면에서 사라지므로, 비자리 라벨이 하나라도 있으면 기본 폼으로 본다.
 */
async function slotFormOn(args: {
  admin: Admin;
  tenantId: string;
  classId: string;
  planDate: string;
  slotStart: string;
}): Promise<RosterForm> {
  const { data, error } = await args.admin
    .from("class_schedules")
    .select("start_time, slot_teacher_label, valid_from, valid_to")
    .eq("tenant_id", args.tenantId)
    .eq("class_id", args.classId)
    .eq("day_of_week", dowKeyOf(args.planDate));
  if (error) throw error;
  const live = (data ?? []).filter((s) => {
    if (String(s.start_time ?? "").slice(0, 5) !== args.slotStart) return false;
    const from = s.valid_from ? String(s.valid_from).slice(0, 10) : null;
    const to = s.valid_to ? String(s.valid_to).slice(0, 10) : null;
    if (from && args.planDate < from) return false;
    if (to && args.planDate > to) return false;
    return true;
  });
  if (live.length === 0) return "default";
  const forms = live.map((s) => rosterFormOf(s.slot_teacher_label as string | null));
  return forms.every((f) => f === "selfStudy") ? "selfStudy" : "default";
}

/**
 * 그날 그 반의 명단 — `upsertStudentMark`의 자격 판정과 **같은 규칙**이다(수강 유효 + 등원요일, 없으면
 * 그날 출결이 있는 보강 학생). 규칙이 갈리면 이 함수가 만든 행을 폼이 읽기 전용으로 잠그는 일이 생긴다.
 * 여기에 **그 칸에 결석으로 찍힌 학생 제외**가 더해진다(규칙은 순수 `carryRoster`).
 *
 * 🔴 출결은 **정정을 새 행으로 남기는 append-only 표**다 — `effectiveAttendanceRecords`로 접지 않으면
 *    출석으로 정정된 옛 '결석' 행을 보고 학생을 빼버린다(그 아이 칸만 조용히 안 채워진다).
 */
async function eligibleRoster(args: {
  admin: Admin;
  tenantId: string;
  classId: string;
  planDate: string;
  slotStart: string;
}): Promise<string[]> {
  const dow = dowKeyOf(args.planDate);
  const [{ data: enrs, error: enrErr }, { data: atts, error: attErr }] = await Promise.all([
    args.admin
      .from("enrollments")
      .select(
        "student_id, start_date, end_date, on_hold, is_transferred, attendance_days, students!inner(withdrawn_at)",
      )
      .eq("tenant_id", args.tenantId)
      .eq("class_id", args.classId),
    args.admin
      .from("attendance_records")
      // 정정 접기에 필요한 칼럼을 다 싣는다(id·recorded_at·slot_start가 없으면 최신 행을 못 고른다).
      .select("id, student_id, class_id, session_date, slot_start, status, recorded_at")
      .eq("tenant_id", args.tenantId)
      .eq("class_id", args.classId)
      .eq("session_date", args.planDate),
  ]);
  if (enrErr) throw enrErr;
  if (attErr) throw attErr;

  const eligible: string[] = [];
  for (const e of enrs ?? []) {
    const withdrawnAt =
      (e.students as unknown as { withdrawn_at: string | null } | null)?.withdrawn_at ?? null;
    if (withdrawnAt && withdrawnAt < args.planDate) continue;
    if (
      !isEnrollmentActiveOn(
        {
          startDate: e.start_date as string,
          endDate: (e.end_date as string | null) ?? null,
          onHold: e.on_hold as boolean,
          isTransferred: (e.is_transferred as boolean | null) ?? undefined,
        },
        args.planDate,
      )
    ) {
      continue;
    }
    if (!enrollmentAttendsOnDay(e.attendance_days as string[] | null, dow)) continue;
    eligible.push(e.student_id as string);
  }

  const attendance: DayAttendance[] = effectiveAttendanceRecords(
    (atts ?? []) as unknown as Parameters<typeof effectiveAttendanceRecords>[0],
  ).map((r) => ({
    studentId: r.student_id,
    slotStart: r.slot_start ? String(r.slot_start).slice(0, 5) : null,
    status: String((r as unknown as { status: string }).status ?? ""),
  }));
  return carryRoster({ eligible, attendance, slotStart: args.slotStart });
}

/** 지난 기록 — 이 반에서 최근 56일 안에 두 칸 중 하나라도 적힌 행(최신 먼저). */
async function pastMarks(args: {
  admin: Admin;
  tenantId: string;
  classId: string;
  planDate: string;
}): Promise<{ rows: PastMarkRow[]; pending: boolean }> {
  const from = shiftYmd(args.planDate, -LOOKBACK_DAYS);
  const { data, error } = await args.admin
    .from("class_sheet_student_marks")
    .select("student_id, mark_date, slot_start, listening_level, memorized_words")
    .eq("tenant_id", args.tenantId)
    .eq("class_id", args.classId)
    .gte("mark_date", from)
    .lt("mark_date", args.planDate)
    .or("listening_level.not.is.null,memorized_words.not.is.null")
    .order("mark_date", { ascending: false })
    .limit(PAST_ROWS_CAP);
  if (error) {
    if (isMissingColumn(error)) return { rows: [], pending: true };
    throw error;
  }
  return {
    rows: (data ?? []).map((r) => ({
      studentId: r.student_id as string,
      markDate: String(r.mark_date).slice(0, 10),
      slotStart: r.slot_start ? String(r.slot_start).slice(0, 5) : null,
      listeningLevel: (r.listening_level as string | null) ?? null,
      memorizedWords: (r.memorized_words as string | null) ?? null,
    })),
    pending: false,
  };
}

/** 대상 칸의 현재 값 — 이미 쓴 칸을 덮지 않으려면 먼저 읽어야 한다. */
async function targetMarks(args: {
  admin: Admin;
  tenantId: string;
  classId: string;
  planDate: string;
  slotStart: string;
}): Promise<{ rows: TargetMarkRow[] }> {
  const { data, error } = await args.admin
    .from("class_sheet_student_marks")
    .select("student_id, listening_level, memorized_words")
    .eq("tenant_id", args.tenantId)
    .eq("class_id", args.classId)
    .eq("mark_date", args.planDate)
    .eq("slot_start", args.slotStart);
  if (error) {
    // 컬럼이 없으면 pastMarks가 이미 pending으로 접는다 — 여기선 빈 목록(덮어쓸 값도 없다).
    if (isMissingColumn(error)) return { rows: [] };
    throw error;
  }
  return {
    rows: (data ?? []).map((r) => ({
      studentId: r.student_id as string,
      listeningLevel: (r.listening_level as string | null) ?? null,
      memorizedWords: (r.memorized_words as string | null) ?? null,
    })),
  };
}

/** YYYY-MM-DD ± 일수 — 시간대 없는 날짜 문자열이라 UTC 산술로 충분하다. */
function shiftYmd(ymd: string, days: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
