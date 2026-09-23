import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { isEnrollmentEndedOn } from "@/features/enrollments/eligibility";
import { isExamSlot, slotUsesMonth, type ExamSlotKey } from "../exam-slots";
import { termWindow, type Term } from "../term";
import {
  buildOverviewColumns,
  overviewAvgPct,
  overviewColumnKey,
  type OverviewCell,
  type OverviewColumn,
  type OverviewRow,
} from "../overview";
import { gradeTeacherClassIds } from "./teacher-classes";
import { gradeMonthReady, gradeNoExamReady, gradesSchemaReady } from "./write";

/**
 * **성적 확인 뷰** 한 판 — 그 학기 명단 × 그 과목의 모든 시험(원장 2026-09-23:
 * *"이 창은 기입창이고 확인하는 뷰페이지를 추가로 만들어야할듯"*).
 *
 * 🔑 입력 격자(`getGradeSheet`)와 **다른 화면**이라 따로 조회한다 — 저쪽은 시험 한 칸을 세로로 적는
 *    화면이라 표식·'시험없음' 사유·반 열이 필요하고, 이쪽은 시험을 가로로 늘어놓고 눈으로 훑는다.
 * 🔑 **읽기 전용**이라 쓰기 게이트가 없다(메뉴 권한은 페이지의 `requireAccess`가 본다).
 * 🔴 과목은 합쳐서 본다 — 영어의 EiE/인재원 트랙으로 나누지 않는다(원장 2026-09-22).
 * ⚠️ 강사는 **자기 과목만**(입력 격자와 같은 규약) — 영어 강사에게 수학 성적표가 열리지 않게.
 * ⚠️ 0283a/0287a 미적용에도 산다([[#95]]) — 컬럼이 없으면 그 열을 안 읽고 빈 표를 낸다.
 * ⚠️ **알려진 한계(입력 격자와 같다)**: 반은 `is_active=true`만 본다 — 지난 학기 뒤 폐지한 반의
 *    학생은 이 표에도 안 선다. 고치려면 두 화면을 **함께** 고쳐야 하고(한쪽만 넓히면 확인 뷰에는
 *    보이는데 고칠 수는 없는 줄이 생긴다), 그때 보이지 않는 '보강' 반(0241a)을 빼는 것도 함께
 *    챙겨야 한다(지금은 `is_active=false`가 그 일을 겸한다).
 * 🔴 강사 스코프는 입력 격자와 **똑같이 반 단위**다(담임 ∪ 부담임, `gradeTeacherClassIds`) —
 *    한쪽만 과목 기준으로 두면 격자에선 안 보이는 반이 확인 뷰에서 통째로 열린다([[#77]]).
 */
export type GradeOverview = {
  columns: OverviewColumn[];
  rows: OverviewRow[];
  /** 반 드롭다운(이 과목 전체) — 화면이 좁힐 때 쓴다. */
  classes: { id: string; className: string }[];
  schemaReady: boolean;
};

export type OverviewSelection = {
  year: number;
  term: Term;
  subject: string;
  /** null = 이 과목 전체. */
  classId: string | null;
};

export async function getGradeOverview(sel: OverviewSelection): Promise<GradeOverview> {
  const empty: GradeOverview = { columns: [], rows: [], classes: [], schemaReady: true };
  const user = await getCurrentUser();
  if (!user) return { ...empty, schemaReady: false };
  const supabase = await createClient();

  const scope = await effectiveTeacherScope();
  if (scope?.subjects && !scope.subjects.includes(sel.subject)) return empty;
  const teacherId = scope ? await effectiveTeacherId() : null;
  // 담임 ∪ 부담임 — 입력 격자와 **같은 헬퍼**(공용 스코프를 넓히지 않는다).
  const myClassIds = new Set(teacherId ? await gradeTeacherClassIds(teacherId) : []);

  const { start: termStart, end: termEnd } = termWindow(sel.year, sel.term);

  const { data: classRows, error: classErr } = await supabase
    .from("classes")
    .select("id, class_name")
    .eq("subject", sel.subject)
    .eq("is_active", true)
    .order("class_name");
  if (classErr) throw new Error(`getGradeOverview(classes): ${classErr.message}`);
  // 🔴 **여기서 좁힌다** — 강사면 담당 반만. 드롭다운·명단·점수가 전부 이 목록에서 파생된다.
  const visible = scope ? (classRows ?? []).filter((c) => myClassIds.has(c.id)) : (classRows ?? []);
  const classes = visible.map((c) => ({ id: c.id, className: c.class_name }));
  const classById = new Map(classes.map((c) => [c.id, c.className]));
  const targetIds = sel.classId ? classes.filter((c) => c.id === sel.classId).map((c) => c.id) : classes.map((c) => c.id);
  if (targetIds.length === 0) return { ...empty, classes, schemaReady: await gradesSchemaReady() };

  type EnrollRow = {
    id: string;
    student_id: string;
    class_id: string;
    start_date: string;
    end_date: string | null;
    is_transferred: boolean | null;
  };
  const enrollments = await fetchAllPagedInChunks<EnrollRow>(targetIds, (chunk, from, to) =>
    supabase
      .from("enrollments")
      .select("id, student_id, class_id, start_date, end_date, is_transferred")
      .in("class_id", chunk)
      .lte("start_date", termEnd)
      .or(`end_date.is.null,end_date.gte.${termStart}`)
      // 🔴 페이징 정렬 키는 **유일해야** 한다 — `student_id`는 한 학생이 반 둘이면 겹쳐서
      //    1000행 경계에서 같은 행을 두 번 받거나 빠뜨린다.
      .order("id")
      .range(from, to),
  );
  const inTerm = enrollments.filter(
    (e) => !isEnrollmentEndedOn(e.end_date, termStart, e.is_transferred ?? false),
  );
  const studentIds = [...new Set(inTerm.map((e) => e.student_id))];
  if (studentIds.length === 0) return { ...empty, classes, schemaReady: await gradesSchemaReady() };

  const [schemaReady, monthReady, noExamReady] = await Promise.all([
    gradesSchemaReady(),
    gradeMonthReady(),
    gradeNoExamReady(),
  ]);
  // 아직 없는 컬럼을 select에 넣으면 PostgREST 400으로 화면이 죽는다([[#95]]) — 준비된 것만 읽는다.
  const COLS = [
    "student_id, exam_slot, score, max_score",
    monthReady ? ", exam_month" : "",
    noExamReady ? ", no_exam" : "",
  ].join("");
  type Cell = {
    student_id: string;
    exam_slot: string | null;
    score: string | null;
    max_score: string | null;
    exam_month?: number | null;
    no_exam?: boolean | null;
  };

  const [students, cells] = await Promise.all([
    fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null; status: string | null }>(
      studentIds,
      (chunk) => supabase.from("students").select("id, name, school, grade, status").in("id", chunk),
    ),
    schemaReady
      ? // 🔴 학생 100명 청크 × 시험 10칸이면 1000행에 닿는다 — 청크만으로는 **조용히 잘린다**(B2).
        //    페이지네이션까지 건다(정렬 키는 유일한 `id`).
        fetchAllPagedInChunks<Cell>(
          studentIds,
          (chunk, from, to) =>
            supabase
              .from("student_grades")
              .select(COLS)
              .eq("subject", sel.subject)
              .eq("school_year", sel.year)
              .eq("term", sel.term)
              .in("student_id", chunk)
              .order("id")
              .range(from, to) as unknown as PromiseLike<{
              data: Cell[] | null;
              error: { message: string } | null;
            }>,
        )
      : Promise.resolve([]),
  ]);

  const num = (v: string | number | null | undefined): number | null => (v == null ? null : Number(v));
  const byStudent = new Map<string, Record<string, OverviewCell>>();
  const present: { slot: ExamSlotKey; month: number }[] = [];
  for (const c of cells) {
    if (!isExamSlot(c.exam_slot)) continue; // 옛 자유 텍스트 시험명은 이 표에 안 세운다
    const month = slotUsesMonth(c.exam_slot) ? (c.exam_month ?? 0) : 0;
    const key = overviewColumnKey(c.exam_slot, month);
    const cell = { score: num(c.score), maxScore: num(c.max_score), noExam: c.no_exam === true };
    // 🔴 **값이 있는 칸만** 열을 세운다 — 독촉 표식만 눌러 둔 행(점수 null)까지 세면 아무도 안 친
    //    시험이 빈 열로 깔린다(적대적 리뷰 2026-09-23).
    if (cell.score != null || cell.noExam) present.push({ slot: c.exam_slot, month });
    const map = byStudent.get(c.student_id) ?? {};
    map[key] = cell;
    byStudent.set(c.student_id, map);
  }
  const columns = buildOverviewColumns(sel.subject, present);

  // 학생 한 명 = 한 줄. 반은 **여럿일 수 있어** 모아 적는다(표에 반 열이 하나뿐이라 줄을 나누면
  // 같은 점수가 두 번 보인다 — 입력 격자와 같은 규약).
  const classNamesByStudent = new Map<string, Set<string>>();
  for (const e of inTerm) {
    const name = classById.get(e.class_id);
    if (!name) continue;
    const set = classNamesByStudent.get(e.student_id) ?? new Set<string>();
    set.add(name);
    classNamesByStudent.set(e.student_id, set);
  }

  const rows: OverviewRow[] = [];
  for (const s of students) {
    const cellMap = byStudent.get(s.id) ?? {};
    // ⚠️ 퇴원 학생은 **적어 둔 것이 있을 때만** 남긴다(입력 격자와 같은 규약).
    const has = Object.values(cellMap).some((c) => c.score != null || c.noExam);
    if (s.status === "withdrawn" && !has) continue;
    rows.push({
      studentId: s.id,
      name: s.name,
      school: s.school,
      grade: s.grade,
      classNames: [...(classNamesByStudent.get(s.id) ?? [])].sort((a, b) => a.localeCompare(b, "ko")),
      cells: cellMap,
      avgPct: overviewAvgPct(columns.map((col) => cellMap[col.key]).filter((c): c is OverviewCell => !!c)),
    });
  }
  // 기본 정렬 = 학년 → 이름(입력 격자의 기본과 같다).
  rows.sort(
    (a, b) =>
      (a.grade ?? "").localeCompare(b.grade ?? "", "ko") || a.name.localeCompare(b.name, "ko"),
  );

  return { columns, rows, classes, schemaReady };
}

