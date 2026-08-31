import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { fetchAllPaged, fetchInChunks } from "@/lib/supabase/batch";
import { kstMonth, kstToday, monthLabel, monthRange } from "@/lib/date-kst";
import { classDaysOf, normalizeMonth, type ClassDay, type MathScheduleRow } from "../lib/class-days";
import {
  cellStateOf,
  foldDayAttendance,
  tallyCells,
  type MathCellState,
  type MathFillStats,
} from "../lib/cell-state";
import {
  isOffGoalRecord,
  offGoalCountByDate,
  type MathRecordLike,
  type StudentGoalMap,
} from "../lib/student-goals";
import { DEFAULT_STALL_RUN, stalledDatesOf } from "../lib/progress-stall";
import { readMcsMonthView, type McsMonthView } from "../view-prefs";
import { requireMcsClassAccess } from "./access";

/**
 * MCS **월간 뷰** 조회 — 반 1개 × 달 1개, 축은 **학생 × 수업일**.
 *
 * 🔴 **실제 진도를 담는 새 표는 없다.** 교재·진도·과제는 이미 `lesson_reports`에 매일 쌓인다
 *    (실측 2026-08: 1,737건 전부 수학). 이 화면은 그걸 월 단위로 세워 보여줄 뿐이고 새로 쓰는 것은
 *    학생별 월간 목표(`math_month_goals`) 하나뿐이다.
 * 🔴 **목표 표가 아직 없어도 화면은 살아야 한다**([[#95]] — SQL은 원장이 손으로 적용한다).
 *    목표 조회만 fail-soft로 빈 맵이 되고, '미작성'·'진도 정체'는 그대로 뜬다.
 * ⚠️ `math_month_goals`·`class_sheet_*`와 같은 규약으로 **admin 클라이언트 + tenant_id 명시 필터**
 *    ([[#104]] — admin은 RLS 우회라 필터를 빼면 남의 테넌트가 섞인다).
 */
export type MathStudentRow = {
  studentId: string;
  name: string;
  school: string | null;
  grade: string | null;
  /** 날짜 → 그 칸의 상태. 열에 없는 날짜는 키가 없다. */
  cells: Record<string, MathCellState>;
  /** 날짜 → 그 날 기록(있을 때만). */
  records: Record<string, MathDayRecord>;
  /** 정체로 판정된 날짜(진도 문자열이 임계만큼 연속으로 같은 날). */
  stalledDates: string[];
  /** 활성 진도 컨테이너(현행·선행) — 수학에만 있는 재료. 없으면 빈 배열. */
  tracks: MathTrack[];
};

export type MathDayRecord = {
  textbook: string | null;
  progress: string | null;
  homework: string | null;
  /** 목표 밖 교재인가(목표가 없으면 항상 false). */
  offGoal: boolean;
};

export type MathTrack = {
  track: string;
  trackLabel: string;
  gradeScope: string | null;
  startPosition: number | null;
  lastPosition: number | null;
  chapterCount: number;
};

export type MathSheetMonthData = {
  classId: string;
  className: string;
  month: string;
  monthLabel: string;
  today: string;
  teacherName: string | null;
  /** 열 — 그 달에 이 반이 도는 날. 비면 "이 달엔 수업이 없다". */
  days: ClassDay[];
  students: MathStudentRow[];
  goals: StudentGoalMap;
  /** 날짜 → 목표 밖 기록 수(열 머리 강조). */
  offGoalByDate: Record<string, number>;
  /** 이 달에 실제로 나간 교재 전체(목표 입력 자동완성 후보 — 표기 흔들림을 입력 단계에서 줄인다). */
  bookOptions: string[];
  fill: MathFillStats;
  canEdit: boolean;
  /**
   * 목표를 읽을 수 있었나 — 화면이 그 사실을 조용히 삼키지 않게.
   * `missing-table` = 0237a 미적용 / `failed` = 그 밖의 조회 실패(원인 단정 금지).
   */
  goalsStatus: GoalsStatus;
  view: McsMonthView;
};

export type GoalsStatus = "ok" | "missing-table" | "failed";

export type MathMonthResult = { ok: true; data: MathSheetMonthData } | { ok: false; error: string };

const TRACK_LABEL: Record<string, string> = { current: "현행", ahead: "선행" };

type MathReportRow = {
  student_id: string;
  report_date: string;
  textbook: string | null;
  progress: string | null;
  homework_today: string | null;
};
type MathAttRow = { student_id: string; session_date: string; status: string | null };

export async function getMathSheetMonth(
  classId: string,
  monthRaw: string | null,
): Promise<MathMonthResult> {
  const gate = await requireMcsClassAccess(classId);
  if (!gate.ok) return { ok: false, error: gate.error };
  const access = gate.access;

  const today = kstToday();
  const month = normalizeMonth(monthRaw, kstMonth());
  const { from, to } = monthRange(month);
  const admin = createAdminClient();
  const tenantId = access.tenantId;

  // 독립 조회는 병렬(B4).
  const [schedRes, enrRes, reportRows, attRows, goalRes, prefRes, teacherRes] = await Promise.all([
    admin
      .from("class_schedules")
      .select("day_of_week, start_time, end_time, valid_from, valid_to")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
    admin
      .from("enrollments")
      .select("student_id, start_date, end_date")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId),
    // 한 반 한 달이면 수백 행이지만 상한을 두지 않는다(B2) — 큰 반 × 긴 달이면 1,000에 닿을 수 있다.
    // ⚠️ 페이지가 흔들리지 않게 **unique tie-break**(id)를 반드시 붙인다(batch.ts 규약).
    fetchAllPaged<MathReportRow>((f, t) =>
      admin
        .from("lesson_reports")
        .select("student_id, report_date, textbook, progress, homework_today")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .gte("report_date", from)
        .lte("report_date", to)
        .order("report_date")
        .order("id")
        .range(f, t),
    ),
    fetchAllPaged<MathAttRow>((f, t) =>
      admin
        .from("attendance_records")
        .select("student_id, session_date, status")
        .eq("tenant_id", tenantId)
        .eq("class_id", classId)
        .gte("session_date", from)
        .lte("session_date", to)
        .order("id")
        .range(f, t),
    ),
    admin
      .from("math_month_goals")
      .select("student_id, textbook, target_progress")
      .eq("tenant_id", tenantId)
      .eq("class_id", classId)
      .eq("period_start", from),
    admin.from("users").select("ui_prefs").eq("id", access.user.id).maybeSingle(),
    access.teacherId
      ? admin.from("users").select("display_name").eq("id", access.teacherId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const days = classDaysOf(
    month,
    (schedRes.data ?? []).map(
      (r): MathScheduleRow => ({
        dayOfWeek: String(r.day_of_week),
        startTime: String(r.start_time),
        endTime: r.end_time ? String(r.end_time) : null,
        validFrom: r.valid_from ? String(r.valid_from).slice(0, 10) : null,
        validTo: r.valid_to ? String(r.valid_to).slice(0, 10) : null,
      }),
    ),
  );
  const dayDates = days.map((d) => d.date);
  const daySet = new Set(dayDates);

  // 🔴 목표 표가 없으면(SQL 미적용) 조용히 빈 맵 — 화면은 살고 경고만 안 뜬다([[#95]]).
  // ⚠️ **원인을 단정하지 않는다**: 표가 없는 것(42P01·PGRST205)과 그냥 조회가 실패한 것은 다른 사실이라
  //    한 문구로 뭉치면 화면이 거짓말을 한다(권한·네트워크 실패를 "SQL 미적용"이라 부르게 된다).
  const goalErrCode = goalRes.error ? String(goalRes.error.code ?? "") : "";
  const goalsStatus: GoalsStatus = !goalRes.error
    ? "ok"
    : goalErrCode === "42P01" || goalErrCode === "PGRST205" || /does not exist|could not find the table/i.test(goalRes.error.message ?? "")
      ? "missing-table"
      : "failed";
  const goals: StudentGoalMap = {};
  for (const row of goalRes.data ?? []) {
    goals[String(row.student_id)] = {
      textbook: row.textbook ?? null,
      targetProgress: row.target_progress ?? null,
    };
  }

  // 로스터 — 이 달 안에 한 번이라도 명단이었던 학생. 수강 구간은 학생마다 여러 건일 수 있다.
  const enrByStudent = new Map<string, { startDate: string | null; endDate: string | null }[]>();
  for (const e of enrRes.data ?? []) {
    const sid = String(e.student_id);
    const list = enrByStudent.get(sid) ?? [];
    list.push({
      startDate: e.start_date ? String(e.start_date).slice(0, 10) : null,
      endDate: e.end_date ? String(e.end_date).slice(0, 10) : null,
    });
    enrByStudent.set(sid, list);
  }

  const studentIds = [...enrByStudent.keys()];
  const students = studentIds.length
    ? await fetchInChunks(studentIds, (chunk) =>
        admin.from("students").select("id, name, school, grade").eq("tenant_id", tenantId).in("id", chunk),
      )
    : [];
  const studentById = new Map(students.map((s) => [String(s.id), s]));

  // 그 학생·그 날의 출결(교시 여럿이면 대표 하나로 접는다 — 결석이 이긴다).
  const attByKey = new Map<string, string[]>();
  for (const a of attRows) {
    const key = `${String(a.student_id)}|${String(a.session_date).slice(0, 10)}`;
    const list = attByKey.get(key) ?? [];
    list.push(String(a.status));
    attByKey.set(key, list);
  }

  const recordByKey = new Map<string, (typeof reportRows)[number]>();
  for (const r of reportRows) {
    const date = String(r.report_date).slice(0, 10);
    // 🔴 수업일이 아닌 날의 기록(보강 등)은 열이 없어 놓을 자리가 없다 — 담지 않는다.
    //    담으면 툴바 요약과 표에 보이는 칸 수가 어긋난다.
    if (!daySet.has(date)) continue;
    recordByKey.set(`${String(r.student_id)}|${date}`, r);
  }

  const rows: MathStudentRow[] = [];
  const allStates: MathCellState[] = [];
  for (const sid of studentIds) {
    const info = studentById.get(sid);
    if (!info) continue; // 학생 행이 없으면(삭제 등) 그릴 것이 없다
    const enrollments = enrByStudent.get(sid) ?? [];
    const cells: Record<string, MathCellState> = {};
    const records: Record<string, MathDayRecord> = {};
    for (const date of dayDates) {
      const rec = recordByKey.get(`${sid}|${date}`);
      const state = cellStateOf({
        enrollments,
        date,
        attendance: foldDayAttendance(attByKey.get(`${sid}|${date}`) ?? []),
        hasReport: Boolean(rec),
      });
      cells[date] = state;
      allStates.push(state);
      if (rec) {
        records[date] = {
          textbook: rec.textbook ?? null,
          progress: rec.progress ?? null,
          homework: rec.homework_today ?? null,
          // 칸 테두리·열 머리·툴바 요약이 **같은 함수**를 통과한다(갈리면 한 화면에서 서로 다른 답이 된다).
          offGoal: isOffGoalRecord(
            { studentId: sid, date, textbook: rec.textbook ?? null, progress: rec.progress ?? null },
            goals,
          ),
        };
      }
    }
    // 명단에 한 번도 안 걸린 학생은 행을 만들지 않는다(달 전체가 off-roster).
    if (dayDates.length > 0 && dayDates.every((d) => cells[d] === "off-roster")) continue;
    rows.push({
      studentId: sid,
      name: String(info.name),
      school: info.school ? String(info.school) : null,
      grade: info.grade ? String(info.grade) : null,
      cells,
      records,
      stalledDates: stalledDatesOf(
        dayDates
          .filter((d) => records[d])
          .map((d) => ({ date: d, progress: records[d]!.progress })),
        DEFAULT_STALL_RUN,
      ),
      tracks: [],
    });
  }

  // 진도 컨테이너(현행·선행) — 수학에만 있는 재료. 조회 실패는 빈 배열로 강등(화면은 산다).
  if (rows.length > 0) {
    try {
      const containers = await fetchInChunks(
        rows.map((r) => r.studentId),
        (chunk) =>
          admin
            .from("progress_containers")
            .select("student_id, track, grade_scope, start_position, last_position, chapter_count")
            .eq("tenant_id", tenantId)
            .eq("status", "active")
            .in("student_id", chunk),
      );
      const byStudent = new Map<string, MathTrack[]>();
      for (const c of containers) {
        const sid = String(c.student_id);
        const list = byStudent.get(sid) ?? [];
        list.push({
          track: String(c.track),
          trackLabel: TRACK_LABEL[String(c.track)] ?? String(c.track),
          gradeScope: c.grade_scope ? String(c.grade_scope) : null,
          startPosition: c.start_position ?? null,
          lastPosition: c.last_position ?? null,
          chapterCount: Number(c.chapter_count ?? 0),
        });
        byStudent.set(sid, list);
      }
      for (const row of rows) {
        // 현행 먼저, 그 다음 선행 — 화면 순서를 조회 순서에 맡기지 않는다.
        row.tracks = (byStudent.get(row.studentId) ?? []).sort((a, b) =>
          a.track === b.track ? 0 : a.track === "current" ? -1 : 1,
        );
      }
    } catch {
      // 보조 재료라 없어도 A안(진도표)은 온전하다.
    }
  }

  rows.sort((a, b) => a.name.localeCompare(b.name, "ko"));

  // 🔴 열 머리 경고는 **화면에 실제로 그려지는 행**에서만 센다. 기록 전체로 세면 표에 없는 학생
  //    (그 달 내내 수강 밖인데 기록만 남은 경우)까지 세어 **경고 표시된 열에 정작 경고 칸이 없다**.
  const shownRecords: MathRecordLike[] = rows.flatMap((row) =>
    Object.entries(row.records).map(([date, rec]) => ({
      studentId: row.studentId,
      date,
      textbook: rec.textbook,
      progress: rec.progress,
    })),
  );
  const offGoalByDate = offGoalCountByDate(shownRecords, goals);

  const bookOptions: string[] = [];
  for (const rec of shownRecords) {
    const book = (rec.textbook ?? "").trim();
    if (book && !bookOptions.includes(book)) bookOptions.push(book);
  }
  bookOptions.sort((a, b) => a.localeCompare(b, "ko"));

  return {
    ok: true,
    data: {
      classId: access.classId,
      className: access.className,
      month,
      monthLabel: monthLabel(month),
      today,
      teacherName: (teacherRes.data as { display_name?: string } | null)?.display_name ?? null,
      days,
      students: rows,
      goals,
      offGoalByDate,
      bookOptions,
      fill: tallyCells(allStates),
      canEdit: access.canWrite,
      goalsStatus,
      view: readMcsMonthView((prefRes.data as { ui_prefs?: unknown } | null)?.ui_prefs),
    },
  };
}
