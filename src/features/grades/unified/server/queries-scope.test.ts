import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 성적 전체 현황의 **범위 표시**(운영점검 2026-10-03 A24).
 * 화면 제목("담당 반 통합 추이" / "학원 통합 추이")은 조회가 돌려주는 `scoped` 하나를 본다. 그 값이 **기록을 거르는
 * 바로 그 판정**(effectiveTeacherScope)과 같은 변수에서 나오는지, 그리고 걸렀을 때 남는 기록의 값은 그대로인지를 고정한다.
 *
 * 실제 `getUnifiedGrades`를 부른다. 바꿔 끼운 것은 IO뿐이다(로그인·범위 판정·DB 조회). DB 스텁은 `.eq`·`.in`을 실제로 걸어
 * 지점 필터와 반 필터가 조회 단계에서 듣는지 본다.
 */
type Row = Record<string, unknown>;
type Scope = { classIds: string[]; studentIds: string[]; subjects: string[] } | null;
const m = vi.hoisted(() => ({
  user: { id: "u1", tenantId: "t1", systemRole: "admin" } as { id: string; tenantId: string; systemRole: string } | null,
  scope: null as { classIds: string[]; studentIds: string[]; subjects: string[] } | null,
  teacherId: null as string | null,
  myClassIds: [] as string[],
  teacherIdCalls: 0,
  myClassCalls: [] as string[],
  tables: {} as Record<string, Record<string, unknown>[]>,
  touched: [] as string[],
}));

vi.mock("@/lib/auth/current-user", () => ({ getCurrentUser: async () => m.user }));
vi.mock("@/lib/auth/view-mode", () => ({
  effectiveTeacherScope: async () => m.scope,
  effectiveTeacherId: async () => {
    m.teacherIdCalls += 1;
    return m.teacherId;
  },
}));
vi.mock("@/features/grades/server/teacher-classes", () => ({
  gradeTeacherClassIds: async (teacherId: string) => {
    m.myClassCalls.push(teacherId);
    return m.myClassIds;
  },
}));
vi.mock("@/features/grades/server/write", () => ({
  gradesSchemaReady: async () => true,
  gradeNoExamReady: async () => true,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      m.touched.push(table);
      let rows: Row[] = [...(m.tables[table] ?? [])];
      const b: Record<string, unknown> = {};
      for (const k of ["select", "lte", "gte", "or", "ilike", "order"]) b[k] = () => b;
      b.eq = (col: string, val: unknown) => {
        rows = rows.filter((r) => r[col] === val);
        return b;
      };
      b.in = (col: string, vals: unknown[]) => {
        rows = rows.filter((r) => vals.includes(r[col]));
        return b;
      };
      b.range = (from: number, to: number) => Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      b.then = (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve({ data: rows, error: null }).then(ok, bad);
      return b;
    },
  }),
}));

import { aggregateBy, withPreviousScores } from "../model";
import { getUnifiedGrades } from "./queries";

const T = "t1";
const klass = (id: string, subject: string, teacher: string): Row => ({ tenant_id: T, id, class_name: id, subject, teacher_id: teacher });
const enrollment = (student: string, classId: string): Row => ({
  tenant_id: T, id: `e-${student}-${classId}`, student_id: student, class_id: classId,
  start_date: "2026-03-02", end_date: null, attendance_days: null, is_transferred: false,
});
const grade = (id: string, student: string, subject: string, score: number, takenOn = "2026-09-20", tenant = T): Row => ({
  tenant_id: tenant, id, student_id: student, exam_name: "9월 월말평가", subject,
  score: String(score), max_score: "100", taken_on: takenOn, exam_slot: null, school_year: 2026, term: 2, no_exam: false,
});
const student = (id: string, name: string, tenant = T): Row => ({ tenant_id: tenant, id, name, school: "대구일중", grade: "중2" });

/** 세 반 · 세 학생. 수학 A반(강사 t1) · 수학 B반(강사 t2) · 영어 C반(강사 t1). 다른 지점 줄도 하나 섞어 둔다. */
function seed() {
  m.tables = {
    classes: [klass("math-a", "math", "t1"), klass("math-b", "math", "t2"), klass("eng-c", "english", "t1"),
      { ...klass("other-x", "math", "tx"), tenant_id: "t2" }],
    enrollments: [enrollment("s1", "math-a"), enrollment("s2", "math-b"), enrollment("s3", "eng-c")],
    class_schedules: [],
    student_grades: [
      grade("g1", "s1", "math", 80),
      grade("g2", "s2", "math", 60),
      grade("g3", "s3", "english", 90),
      grade("g4", "s1", "english", 40), // s1의 영어 기록 — 수학만 맡은 범위에서는 빠져야 한다
      grade("g9", "s9", "math", 10, "2026-09-20", "t2"), // 다른 지점
    ],
    lesson_reports: [],
    level_tests: [],
    students: [student("s1", "김가람"), student("s2", "이나래"), student("s3", "박다온"), student("s9", "남의학생", "t2")],
    student_consultations: [],
    users: [{ tenant_id: T, id: "t1", display_name: "김선생" }, { tenant_id: T, id: "t2", display_name: "이선생" }],
  };
}
const scopeOf = (subjects: string[]): Scope => ({ classIds: ["math-a", "eng-c"], studentIds: ["s1", "s3"], subjects });
const run = () => getUnifiedGrades("2026-09-03", "2026-10-03");
const keys = (records: { key: string }[]) => records.map((r) => r.key).sort();
const academy = (records: Parameters<typeof withPreviousScores>[0]) => aggregateBy(withPreviousScores(records), "academy")[0];

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-03T03:00:00Z")); // KST 2026-10-03 정오
});
afterAll(() => vi.useRealTimers());
beforeEach(() => {
  m.user = { id: "u1", tenantId: T, systemRole: "admin" };
  m.scope = null;
  m.teacherId = null;
  m.myClassIds = [];
  m.teacherIdCalls = 0;
  m.myClassCalls = [];
  m.touched = [];
  seed();
});

describe("관리자(범위 없음)", () => {
  it("scoped = false 이고 지점의 모든 반·학생 기록을 본다", async () => {
    const data = await run();
    expect(data.scoped).toBe(false);
    expect(keys(data.records)).toEqual(["grade:g1", "grade:g2", "grade:g3", "grade:g4"]);
    expect(data.students.map((s) => s.id).sort()).toEqual(["s1", "s2", "s3"]);
    expect(data.classes.map((c) => c.id).sort()).toEqual(["eng-c", "math-a", "math-b"]);
  });

  it("강사 범위 판정을 따로 부르지 않는다 — 범위가 없으면 담당 반 조회도 없다", async () => {
    await run();
    expect(m.teacherIdCalls).toBe(0);
    expect(m.myClassCalls).toEqual([]);
  });

  it("다른 지점의 기록·학생은 섞이지 않는다", async () => {
    const data = await run();
    expect(JSON.stringify(data)).not.toContain("남의학생");
    expect(data.records.some((r) => r.key === "grade:g9")).toBe(false);
    expect(data.classes.some((c) => c.id === "other-x")).toBe(false);
  });
});

describe("강사 범위(실 강사 · 겸직 강사뷰 · 다른 강사 뷰 — 조회에는 같은 스코프 객체로 들어온다)", () => {
  beforeEach(() => {
    m.scope = scopeOf(["math", "english"]);
    m.teacherId = "t1";
    m.myClassIds = ["math-a", "eng-c"];
  });

  it("scoped = true 이고 담당 반 학생의 기록만 남는다", async () => {
    const data = await run();
    expect(data.scoped).toBe(true);
    expect(keys(data.records)).toEqual(["grade:g1", "grade:g3", "grade:g4"]);
    expect(data.students.map((s) => s.id).sort()).toEqual(["s1", "s3"]);
    expect(data.classes.map((c) => c.id).sort()).toEqual(["eng-c", "math-a"]);
    // 남의 반(수학 B반) 학생은 이름도 내려오지 않는다.
    expect(JSON.stringify(data)).not.toContain("이나래");
    expect(m.myClassCalls).toEqual(["t1"]);
  });

  it("담당 과목 밖의 기록은 빠진다 — 그래도 scoped = true", async () => {
    m.scope = scopeOf(["math"]);
    m.myClassIds = ["math-a"];
    const data = await run();
    expect(data.scoped).toBe(true);
    // 수학만: 영어 C반은 보이는 반에서 빠지고, s1의 영어 기록(g4)도 빠진다.
    expect(keys(data.records)).toEqual(["grade:g1"]);
    expect(data.classes.map((c) => c.id)).toEqual(["math-a"]);
    expect(data.subjects).toEqual(["math"]);
  });

  it("🔴 담당 반이 0개여도 scoped = true — 빈 화면이 '학원 통합'으로 읽히지 않는다", async () => {
    m.myClassIds = [];
    const data = await run();
    expect(data).toMatchObject({ scoped: true, records: [], students: [], classes: [], subjects: [] });
    // 반 목록까지만 읽고 성적·보고서는 조회하지 않는다.
    expect(m.touched).toEqual(["classes"]);
  });

  it("담임 과목이 비어도 교시 담당 반의 기록을 표시한다", async () => {
    m.scope = scopeOf([]);
    const data = await run();
    expect(data.scoped).toBe(true);
    expect(keys(data.records)).toEqual(["grade:g1", "grade:g3", "grade:g4"]);
  });
});

describe("범위는 거르기만 한다 — 남은 기록의 값·집계는 그대로", () => {
  it("강사가 보는 기록은 관리자가 보는 같은 기록과 점수·만점·날짜가 같다", async () => {
    const admin = await run();
    m.scope = scopeOf(["math", "english"]);
    m.teacherId = "t1";
    m.myClassIds = ["math-a", "eng-c"];
    const teacher = await run();
    const pick = (r: (typeof admin.records)[number]) => ({ key: r.key, studentId: r.studentId, subject: r.subject, kind: r.kind, date: r.date, score: r.score, maxScore: r.maxScore });
    const adminByKey = new Map(admin.records.map((r) => [r.key, pick(r)]));
    for (const r of teacher.records) expect(pick(r)).toEqual(adminByKey.get(r.key));
  });

  it("통합 추이(월별 평균)는 '관리자 기록 중 담당 학생 것'으로 낸 값과 같다", async () => {
    const admin = await run();
    m.scope = scopeOf(["math", "english"]);
    m.teacherId = "t1";
    m.myClassIds = ["math-a", "eng-c"];
    const teacher = await run();
    const mine = new Set(["s1", "s3"]);
    const expected = academy(admin.records.filter((r) => mine.has(r.studentId)));
    const actual = academy(teacher.records);
    expect(actual).toEqual(expected);
    // 숫자 자체도 고정한다: (80 + 90 + 40) / 3 = 70.
    expect(actual).toMatchObject({ count: 3, average: 70, points: [{ month: "2026-09", average: 70 }] });
    // 관리자 전체는 다른 숫자다: (80 + 60 + 90 + 40) / 4 = 67.5 — 범위가 걸렸는데 제목이 '학원 통합'이면 이 차이를 오해한다.
    expect(academy(admin.records)).toMatchObject({ count: 4, average: 67.5 });
  });
});

describe("그 밖", () => {
  it("로그인 전에는 빈 결과(scoped = false) — 조회하지 않는다", async () => {
    m.user = null;
    const data = await run();
    expect(data).toMatchObject({ scoped: false, records: [] });
    expect(m.touched).toEqual([]);
  });

  it("학생 한 명만 읽는 경로(학생 상세)도 같은 판정을 돌려준다", async () => {
    expect((await getUnifiedGrades("2026-09-03", "2026-10-03", { studentId: "s1" })).scoped).toBe(false);
    m.scope = scopeOf(["math", "english"]);
    m.teacherId = "t1";
    m.myClassIds = ["math-a", "eng-c"];
    const data = await getUnifiedGrades("2026-09-03", "2026-10-03", { studentId: "s1" });
    expect(data.scoped).toBe(true);
    expect(keys(data.records)).toEqual(["grade:g1", "grade:g4"]);
  });
});
