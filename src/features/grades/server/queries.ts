import "server-only";
import { createClient } from "@/lib/supabase/server";
import { fetchAllPagedInChunks, fetchInChunks } from "@/lib/supabase/batch";
import { getCurrentUser } from "@/lib/auth/current-user";
import { effectiveTeacherId, effectiveTeacherScope } from "@/lib/auth/view-mode";
import { gradeTeacherClassScope } from "./teacher-classes";
import { isEnrollmentEndedOn, isEnrollmentOnRosterOn } from "@/features/enrollments/eligibility";
import { readEnglishTrack } from "@/features/classes/english-track";
import { ENGLISH_SUBJECT_KEY } from "../subject-axis";
import { rosterAnchorFor, termWindow } from "../term";
import { examAppliesTo } from "../applies";
import { EMPTY_GRADE_MARKS, type GradeClassOption, type GradeMarks, type GradeSelection, type GradeSheet, type GradeSheetRow } from "../types";
import { gradeAreasReady, gradeMarksReady, gradeMonthReady, gradeNoExamReady, gradesSchemaReady } from "./write";
import { parseAreas, slotHasAreas } from "../area-scores";
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
  const empty: GradeSheet = {
    selection: sel,
    classes: [],
    rows: [],
    schemaReady: true,
    marksReady: false,
    noExamReady: false,
    monthReady: false,
  };
  const user = await getCurrentUser({ teacherView: true });
  if (!user) return { ...empty, schemaReady: false };


  const supabase = await createClient();

  // 🔴 강사는 **담임·부담임인 반만** 본다(원장 2026-09-23: *"성적관리는 자기가 담임, 부담임반으로
  //    되어있으면 나오고 부원장 관리자 직급은 모든반 볼 수있도록"*). 그전엔 과목 기준이라 영어 강사가
  //    영어 전 반(58개·재원 343명)을 다 봤고 자기 반은 **위로 정렬만** 됐다 — 그건 "담당 학생만 읽는다"
  //    (2026-08-18 F9 결정)와 어긋난다.
  // 🔑 판정 축은 `effectiveTeacherScope()`의 유무 그대로다 — 진짜 강사와 **겸직 관리자의 강사뷰**는
  //    스코프가 서고, 평소의 부원장·관리자(effectiveTeacherId 없음)는 안 선다 = 모든 반.
  // ⚠️ 과목 스코프는 그대로 둔다(영어 강사에게 수학 성적표가 열리지 않게) — 반 필터가 사실상 같은 일을
  //    하지만, 고른 과목이 내 것이 아니면 **명단을 만들기도 전에** 접는 쪽이 싸다.
  const scope = await effectiveTeacherScope();
  const teacherId = scope ? await effectiveTeacherId() : null;
  // 담임 ∪ 부담임 — 공용 스코프(`classes.teacher_id`만 본다)를 넓히지 않고 성적관리 전용으로 구한다.
  const teacherScope = teacherId ? await gradeTeacherClassScope(teacherId) : { ids: [], partial: false };
  const myClassIds = new Set(teacherScope.ids);
  const scopePartial = teacherScope.partial;

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

  // 🔴 **여기서 좁힌다** — 강사면 담당(담임·부담임) 반만 남는다. 드롭다운·명단·엑셀이 전부 이 목록에서
  //    파생되므로 한 곳만 거르면 화면 전체가 따라온다([[#77]] — 정렬로 감추면 주소를 직접 치면 열린다).
  const visible = scope ? tracked.filter((c) => myClassIds.has(c.id)) : tracked;

  const classesById = new Map(visible.map((c) => [c.id, c]));
  const targetIds = sel.classId
    ? visible.filter((c) => c.id === sel.classId).map((c) => c.id)
    : visible.map((c) => c.id);
  // 고른 반이 이 과목·트랙에 없으면(주소를 직접 고쳤거나 반이 폐지됨) 줄은 비우되 **반 목록은 살린다**
  // — 드롭다운까지 비면 다른 반으로 갈 길이 없다.
  const optionsOnly: GradeClassOption[] = visible.map((c) => ({
    id: c.id,
    className: c.class_name,
    track: readEnglishTrack(c),
    studentCount: null,
  }));
  if (targetIds.length === 0) {
    return {
      ...empty,
      scopePartial,
      classes: optionsOnly,
      schemaReady: await gradesSchemaReady(),
      marksReady: await gradeMarksReady(),
      noExamReady: await gradeNoExamReady(),
      monthReady: await gradeMonthReady(),
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
  // 영역 점수(s2_0023)는 영역으로 적는 시험(영어 Monthly Test)에서만 읽는다 — 다른 시험 화면은 이 확인조차 안 한다.
  const wantAreas = slotHasAreas(sel.subject, sel.slot);
  const [schemaReady, marksReady, noExamReady, monthReady, areasReady] = await Promise.all([
    gradesSchemaReady(),
    gradeMarksReady(),
    gradeNoExamReady(),
    gradeMonthReady(),
    wantAreas ? gradeAreasReady() : Promise.resolve(false),
  ]);
  // 표식 컬럼(0284a)이 아직 없으면 그 열만 빼고 읽는다 — 넣으면 PostgREST 400으로 화면이 죽는다([[#95]]).
  // 아직 없는 컬럼을 select에 넣으면 PostgREST 400으로 화면이 죽는다([[#95]]) — 준비된 것만 읽는다.
  const SCORE_COLS = [
    "id, student_id, exam_slot, score, max_score, taken_on",
    marksReady ? ", ask1_at, ask2_at, received_at" : "",
    noExamReady ? ", no_exam, no_exam_reason" : "",
    areasReady ? ", area_scores" : "",
  ].join("");
  type ScoreCell = {
    id: string;
    exam_slot: string | null;
    student_id: string;
    score: string | null;
    max_score: string | null;
    taken_on: string | null;
    ask1_at?: string | null;
    ask2_at?: string | null;
    received_at?: string | null;
    no_exam?: boolean | null;
    no_exam_reason?: string | null;
    area_scores?: unknown;
  };

  const [students, scores] = await Promise.all([
    fetchInChunks<{
      id: string;
      name: string;
      school: string | null;
      grade: string | null;
      status: string | null;
    }>(studentIds, (chunk) =>
      supabase.from("students").select("id, name, school, grade, status").in("id", chunk),
    ),
    schemaReady
      ? fetchInChunks<ScoreCell>(
          studentIds,
          // 🔴 select 문자열이 실행 중에 갈리므로(0284a 유무) 타입 추론이 안 된다 — 반환 모양은 위
          //    `ScoreCell`이 정본이고, 표식 열은 없을 수 있어 **선택 속성**이다.
          (chunk) => {
            let q = supabase
              .from("student_grades")
              .select(SCORE_COLS)
              .eq("subject", sel.subject)
              .eq("school_year", sel.year)
              .eq("term", sel.term);
            q = q.eq("exam_slot", sel.slot);
            // 🔴 월말평가는 달마다 다른 칸이다(0288a) — 안 좁히면 9월·10월 두 행이 같이 와서
            //    Map이 아무거나 하나를 집는다(화면이 지난달 점수를 이번 달로 보여 준다).
            // ⚠️ 0288a 미적용이면 그 컬럼이 없어 필터 자체가 PostgREST 400이다 — 그땐 안 건다([[#95]]).
            if (monthReady) q = q.eq("exam_month", sel.month);
            return q.in("student_id", chunk) as unknown as PromiseLike<{
              data: ScoreCell[] | null;
              error: { message: string } | null;
            }>;
          },
        )
      : Promise.resolve([]),
  ]);

  const studentById = new Map(students.map((s) => [s.id, s]));
  const num = (v: string | number | null): number | null => (v == null ? null : Number(v));
  // 같은 칸에 행이 둘이면(유니크 축이라 정상이면 없다) 시험일이 늦은 쪽이 이긴다 — Map은 나중 값을 남긴다.
  const orderedScores = [...scores].sort((a, b) => (a.taken_on ?? "").localeCompare(b.taken_on ?? ""));
  const scoreByStudent = new Map(
    orderedScores.map((s) => [
      s.student_id,
      {
        id: s.id,
        score: num(s.score),
        maxScore: num(s.max_score),
        takenOn: s.taken_on,
        marks: {
          ask1: s.ask1_at ?? null,
          ask2: s.ask2_at ?? null,
          received: s.received_at ?? null,
        } satisfies GradeMarks,
        noExam: s.no_exam === true,
        noExamReason: s.no_exam_reason ?? null,
        areas: parseAreas(s.area_scores),
      },
    ]),
  );

  const rows: GradeSheetRow[] = [];
  for (const e of inTerm) {
    const student = studentById.get(e.student_id);
    const cls = classesById.get(e.class_id);
    if (!student || !cls) continue; // 이름을 모르는 줄은 세우지 않는다(누구 점수인지 못 적는다).
    // 🔴 제도상 안 치는 시험(초등·중1의 중간·기말)은 **목록에서 뺀다**(원장 2026-09-22:
    //    *"검색 리스트에 빼줘야지 해당없음 이렇게 칠하는게 아니라"*). 회색 줄로 남기면 204줄짜리
    //    화면에서 실제로 적을 줄을 눈으로 골라내야 한다. 저장·엑셀도 같은 집합을 본다.
    // 🔴 학기를 함께 넘긴다 — 중1은 1학기엔 시험을 치므로 빠지면 안 된다(원장 2026-09-23).
    if (!examAppliesTo(sel.slot, student.grade, sel.term)) continue;
    const cell = scoreByStudent.get(e.student_id);
    rows.push({
      studentId: student.id,
      name: student.name,
      school: student.school,
      grade: student.grade,
      classId: cls.id,
      className: cls.class_name,
      score: cell?.score ?? null,
      scoreId: cell?.id ?? null,
      maxScore: cell?.maxScore ?? null,
      takenOn: cell?.takenOn ?? null,
      marks: cell?.marks ?? EMPTY_GRADE_MARKS,
      noExam: cell?.noExam ?? false,
      noExamReason: cell?.noExamReason ?? null,
      areas: cell?.areas ?? null,
      // 여기까지 온 줄은 전부 치는 시험이다(위에서 걸렀다) — 그래도 필드는 남긴다: 엑셀 파서가
      // 이 값으로 "안 치는 시험에 점수가 적혀 왔다"를 판정한다.
      applies: true,
      // 표식 축은 **학원 퇴원** 하나다(위 types 주석). 반 단위 종료는 표식이 아니라 아래 dedupe의 기준일 뿐.
      withdrawn: student.status === "withdrawn",
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

  /*
   * 🔴 **한 학생은 한 줄**(원장 2026-09-22 저녁, 묶음 폐기와 한 몸). 표엔 반 열이 없어서 두 반을
   *    듣는 학생이 두 줄이면 **같은 점수가 두 칸으로** 보이고 어느 쪽이 사실인지 알 수 없다.
   * 🔴 남길 줄은 **지금도 다니는 쪽**을 고른다 — 아무 줄이나 남기면 반이동한 학생이 옛 반 줄로 남아
   *    이름 옆에 '종료'가 붙는다(실측 2026-09-22: 수학 2학기 수강 432건 중 85건이 이미 끝난 행이고
   *    그중 8건이 반이동이었다). 모든 줄이 끝났으면 그때만 '종료'가 붙는다 = 진짜로 그만둔 학생.
   */
  // 남길 줄은 **지금도 도는 반** 쪽(반이동 학생이 옛 반 줄로 남지 않게). 표식과는 다른 축이다.
  const stillOn = new Map<string, boolean>();
  for (const e of inTerm) {
    const on = isEnrollmentOnRosterOn(
      { startDate: e.start_date, endDate: e.end_date, isTransferred: e.is_transferred ?? false },
      anchor,
    );
    if (on) stillOn.set(`${e.student_id}:${e.class_id}`, true);
  }
  const oneEach = new Map<string, GradeSheetRow>();
  for (const r of rows) {
    const cur = oneEach.get(r.studentId);
    const rOn = stillOn.has(`${r.studentId}:${r.classId}`);
    const curOn = cur ? stillOn.has(`${cur.studentId}:${cur.classId}`) : false;
    if (!cur || (!curOn && rOn)) oneEach.set(r.studentId, r);
  }
  /*
   * 🔴 **퇴원한 학생만 뺀다**(원장 2026-09-22: *"퇴원 아니면 떠야 하고"*) — 반이 바뀌었거나 그 과목을
   *    그만뒀어도 **학원에 다니면 그냥 명단에 선다**(표식도 없다).
   * ⚠️ 퇴원이어도 **이미 적어 둔 것이 있으면 남긴다**(점수·시험없음·상담 표식) — 시험을 보고 그만둔
   *    학생의 기록을 화면에서 지우면 아무도 못 고친다. 그 줄에만 '퇴원'이 붙는다.
   */
  const hasAnything = (r: GradeSheetRow) =>
    r.score != null || r.noExam || !!r.marks.ask1 || !!r.marks.ask2 || !!r.marks.received;
  const uniqueRows = [...oneEach.values()].filter((r) => !r.withdrawn || hasAnything(r));

  // 인원은 **이번에 실제로 읽은 반만** 센다 — 반 하나만 볼 땐 나머지 반을 안 읽었으므로 null(모름).
  const countByClass = new Map<string, number>();
  for (const r of rows) countByClass.set(r.classId, (countByClass.get(r.classId) ?? 0) + 1);
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
  return { selection: sel, classes, rows: uniqueRows, schemaReady, marksReady, noExamReady, monthReady, areasReady, scopePartial };
}
