import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherScope } from "@/lib/auth/view-mode";
import { isEnrollmentEndedOn, isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { readEnglishTrack } from "@/features/classes/english-track";
import { ENGLISH_SUBJECT_KEY } from "../subject-axis";
import { rosterAnchorFor, termWindow } from "../term";
import { EMPTY_GRADE_MARKS, type GradeClassOption, type GradeMarks, type GradeSelection, type GradeSheet, type GradeSheetRow } from "../types";
import { gradeMarksReady, gradesSchemaReady } from "./write";
import { kstToday } from "@/lib/date-kst";

/**
 * 성적 입력표 한 판 — **반 목록 + 그 학기 명단 + 이미 적힌 점수**.
 *
 * 🔑 명단은 "오늘 재원"이 아니라 **그 학기에 하루라도 그 반이었던 학생**이다(학기 구간과 수강 구간의
 *    겹침). 지난 학기를 열면 그때 명단이 서고, 학기 중 나간 학생도 줄이 남아 적어 둔 점수가 사라지지 않는다.
 * 🔑 점수는 **반과 무관하게** (학생·과목·학기·시험 칸)으로 붙는다 — 한 학생이 수학 반 둘을 들으면
 *    두 줄에 같은 값이 보이고 한쪽을 고치면 둘 다 바뀐다(학교 시험이라 성적이 하나인 게 사실이다).
 * ⚠️ 강사 스코프는 **과목 기준**이다(옛 시험 목록과 같은 규약) — 반 단위로 더 좁히지 않는다.
 */
export async function getGradeSheet(sel: GradeSelection): Promise<GradeSheet> {
  const empty: GradeSheet = { selection: sel, classes: [], rows: [], schemaReady: true, marksReady: false };
  const user = await getCurrentUser();
  if (!user) return { ...empty, schemaReady: false };


  const supabase = await createClient();

  // 강사(겸직 강사뷰 포함)는 자기 과목만 — 영어 강사에게 수학 성적표가 열리지 않게.
  // 강사(겸직 강사뷰 포함)는 과목 스코프 + **자기 반이 위로** 선다(원장 2026-09-22: "강사는 자기 반
  // 학생들 우선으로 뜨게"). 담당이 아닌 반도 계속 보인다 — 순서만 바뀐다.
  const scope = await effectiveTeacherScope();
  const teacherSubjects = scope?.subjects ?? null;
  const myClassIds = new Set(scope?.classIds ?? []);
  if (teacherSubjects && !teacherSubjects.includes(sel.subject)) return empty;

  const { start: termStart, end: termEnd } = termWindow(sel.year, sel.term);
  const anchor = rosterAnchorFor(sel.year, sel.term, kstToday());

  // 반 목록 — 폐지(is_active=false)는 제외되고, 그래서 보이지 않는 '보강' 반(0241a)도 함께 빠진다
  // (그 컬럼을 select에 넣지 않는 이유는 CLAUDE.md의 0241a 주의사항 그대로).
  const { data: classRows, error: classErr } = await supabase
    .from("classes")
    .select("id, class_name, english_track")
    .eq("subject", sel.subject)
    .eq("is_active", true)
    .order("class_name");
  if (classErr) throw new Error(`getGradeSheet(classes): ${classErr.message}`);

  // 영어만 트랙으로 가른다. 🔴 비대칭: eie는 정확히 일치, injaewon은 "EiE가 아닌 전부"(미분류 포함) —
  // 양쪽을 정확히 일치로 거르면 미분류 영어 반이 두 선택지 모두에서 사라진다(english-track.ts 규약).
  const tracked = (classRows ?? []).filter((c) => {
    if (sel.subject !== ENGLISH_SUBJECT_KEY || !sel.track) return true;
    const track = readEnglishTrack(c);
    return sel.track === "eie" ? track === "eie" : track !== "eie";
  });

  const classesById = new Map(tracked.map((c) => [c.id, c]));
  const targetIds = sel.classId
    ? tracked.filter((c) => c.id === sel.classId).map((c) => c.id)
    : tracked.map((c) => c.id);
  // 고른 반이 이 과목·트랙에 없으면(주소를 직접 고쳤거나 반이 폐지됨) 줄은 비우되 **반 목록은 살린다**
  // — 드롭다운까지 비면 다른 반으로 갈 길이 없다.
  const optionsOnly: GradeClassOption[] = tracked.map((c) => ({
    id: c.id,
    className: c.class_name,
    track: readEnglishTrack(c),
    studentCount: null,
  }));
  if (targetIds.length === 0) {
    return {
      ...empty,
      classes: optionsOnly,
      schemaReady: await gradesSchemaReady(),
      marksReady: await gradeMarksReady(),
    };
  }

  // 학기와 겹치는 수강만 — 넉넉히 받고 판정은 eligibility 단일 소스에서 한다([[#125]] 계열).
  // 페이지네이션 + 청크: 과목 전체(반 80여 개)를 한 번에 볼 수 있어 1000행을 넘길 수 있다.
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
      .order("id")
      .range(from, to),
  );
  const inTerm = enrollments.filter(
    (e) => !isEnrollmentEndedOn(e.end_date, termStart, e.is_transferred ?? false),
  );

  const studentIds = [...new Set(inTerm.map((e) => e.student_id))];
  const [schemaReady, marksReady] = await Promise.all([gradesSchemaReady(), gradeMarksReady()]);
  // 표식 컬럼(0284a)이 아직 없으면 그 열만 빼고 읽는다 — 넣으면 PostgREST 400으로 화면이 죽는다([[#95]]).
  const SCORE_COLS = marksReady
    ? "student_id, score, max_score, taken_on, ask1_at, ask2_at, received_at"
    : "student_id, score, max_score, taken_on";
  type ScoreCell = {
    student_id: string;
    score: string | null;
    max_score: string | null;
    taken_on: string | null;
    ask1_at?: string | null;
    ask2_at?: string | null;
    received_at?: string | null;
  };

  const [students, scores] = await Promise.all([
    fetchInChunks<{ id: string; name: string; school: string | null; grade: string | null }>(
      studentIds,
      (chunk) => supabase.from("students").select("id, name, school, grade").in("id", chunk),
    ),
    schemaReady
      ? fetchInChunks<ScoreCell>(
          studentIds,
          // 🔴 select 문자열이 실행 중에 갈리므로(0284a 유무) 타입 추론이 안 된다 — 반환 모양은 위
          //    `ScoreCell`이 정본이고, 표식 열은 없을 수 있어 **선택 속성**이다.
          (chunk) =>
            supabase
              .from("student_grades")
              .select(SCORE_COLS)
              .eq("subject", sel.subject)
              .eq("school_year", sel.year)
              .eq("term", sel.term)
              .eq("exam_slot", sel.slot)
              .in("student_id", chunk) as unknown as PromiseLike<{
              data: ScoreCell[] | null;
              error: { message: string } | null;
            }>,
        )
      : Promise.resolve([]),
  ]);

  const studentById = new Map(students.map((s) => [s.id, s]));
  const num = (v: string | number | null): number | null => (v == null ? null : Number(v));
  const scoreByStudent = new Map(
    scores.map((s) => [
      s.student_id,
      {
        score: num(s.score),
        maxScore: num(s.max_score),
        takenOn: s.taken_on,
        marks: {
          ask1: s.ask1_at ?? null,
          ask2: s.ask2_at ?? null,
          received: s.received_at ?? null,
        } satisfies GradeMarks,
      },
    ]),
  );

  const rows: GradeSheetRow[] = [];
  for (const e of inTerm) {
    const student = studentById.get(e.student_id);
    const cls = classesById.get(e.class_id);
    if (!student || !cls) continue; // 이름을 모르는 줄은 세우지 않는다(누구 점수인지 못 적는다).
    const cell = scoreByStudent.get(e.student_id);
    rows.push({
      studentId: student.id,
      name: student.name,
      school: student.school,
      grade: student.grade,
      classId: cls.id,
      className: cls.class_name,
      score: cell?.score ?? null,
      maxScore: cell?.maxScore ?? null,
      takenOn: cell?.takenOn ?? null,
      marks: cell?.marks ?? EMPTY_GRADE_MARKS,
      onRoster: isEnrollmentOnRosterOn(
        {
          startDate: e.start_date,
          endDate: e.end_date,
          isTransferred: e.is_transferred ?? false,
        },
        anchor,
      ),
    });
  }
  // 반은 이름순, 같은 반 안에서는 학생 이름순. 🔑 강사가 보면 **자기 반이 먼저**(원장 2026-09-22) —
  // 담당 반 80개를 지나 자기 반을 찾아 내려가지 않게. 사무실(담당 반 없음)은 종전 그대로 이름순.
  const mine = (r: GradeSheetRow) => (myClassIds.has(r.classId) ? 0 : 1);
  rows.sort(
    (a, b) =>
      mine(a) - mine(b) ||
      a.className.localeCompare(b.className, "ko") ||
      a.name.localeCompare(b.name, "ko"),
  );

  // 인원은 **이번에 실제로 읽은 반만** 센다 — 반 하나만 볼 땐 나머지 반을 안 읽었으므로 null(모름).
  const countByClass = new Map<string, number>();
  for (const e of inTerm) countByClass.set(e.class_id, (countByClass.get(e.class_id) ?? 0) + 1);
  const counted = new Set(targetIds);
  const classes: GradeClassOption[] = tracked.map((c) => ({
    id: c.id,
    className: c.class_name,
    track: readEnglishTrack(c),
    studentCount: counted.has(c.id) ? (countByClass.get(c.id) ?? 0) : null,
  }));

  // 반 드롭다운도 같은 순서 — 목록과 표가 다른 순서면 고를 때마다 눈이 다시 찾는다.
  classes.sort(
    (a, b) =>
      (myClassIds.has(a.id) ? 0 : 1) - (myClassIds.has(b.id) ? 0 : 1) ||
      a.className.localeCompare(b.className, "ko"),
  );
  return { selection: sel, classes, rows, schemaReady, marksReady };
}
