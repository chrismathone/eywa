// 전수 조회 — 원장 2026-11-06 *"하나도 빠짐없이 남김없이"*: 대상과 이어진 보기를 이름 규칙으로 전부 찾고, 비서 조회와 같은 검사기를 거쳐 센다.
import { describe, expect, it } from "vitest";
import type { AssistantTableDoc } from "../catalog/types";
import { checkAssistantSql } from "./sql-gate";
import {
  addDays,
  coverageOf,
  dateColumn,
  isRealYmd,
  kstYmd,
  linkColumns,
  runSurvey,
  surveyForModel,
  surveyPlan,
  surveySql,
  taughtClassesSql,
  type SurveyRow,
  type SurveyTable,
} from "./survey";

const ID = "bf52c6d2-5b44-41fc-8268-3248b7eda61b";
const col = (name: string, type = "uuid") => ({ name, type });
const docs: AssistantTableDoc[] = [
  { name: "video_homework_marks", label: "영상숙제 검사", ko: "" },
  { name: "attendance_records", label: "출결", ko: "" },
  { name: "classes", label: "반", ko: "" },
  { name: "push_subscriptions", label: "알림 구독", ko: "", internal: true },
] as AssistantTableDoc[];

const described = [
  { table: "classes", columns: [col("id"), col("teacher_id"), col("closed_at", "date")] },
  { table: "attendance_records", columns: [col("id"), col("class_id"), col("student_id"), col("taught_by"), col("recorded_by"), col("session_date", "date"), col("recorded_at", "timestamp with time zone")] },
  { table: "video_homework_marks", columns: [col("id"), col("class_id"), col("student_id"), col("homework_date", "date"), col("updated_by")] },
  { table: "class_transfers", columns: [col("id"), col("from_class_id"), col("to_class_id"), col("created_at", "timestamp with time zone")] },
  { table: "lesson_reports", columns: [col("id"), col("student_id"), col("created_by"), col("teacher_name", "text"), col("report_date", "date")] },
  { table: "notices", columns: [col("id"), col("title", "text")] },
  { table: "enrollments", columns: [col("id"), col("class_id"), col("student_id"), col("start_date", "date"), col("end_date", "date"), col("created_at", "timestamp with time zone")] },
  { table: "student_grades", columns: [col("id"), col("student_id"), col("taken_on", "date"), col("created_at", "timestamp with time zone")] },
  { table: "push_subscriptions", columns: [col("id"), col("user_id"), col("created_at", "timestamp with time zone")] },
  { table: "classnote_parent_messages", columns: [col("id"), col("student_id"), col("starts_on", "date"), col("ends_on", "date"), col("posted_at", "timestamp with time zone"), col("created_at", "timestamp with time zone")] },
  { table: "approval_steps", columns: [col("id"), col("approver_id"), col("decided_at", "timestamp with time zone"), col("created_at", "timestamp with time zone")] },
  { table: "onto_class_teachers", columns: [col("class_id"), col("teacher_id"), col("valid_from", "date"), col("valid_to", "date")] },
];

describe("전수 조회 — 잇는 칸 · 날짜 칸 · 계획", () => {
  it("대상별 잇는 칸 이름 규칙(uuid만) · 강사는 …_by 전부(대신 보강 taught_by 포함) · 고친 흔적(updated_by)은 뺀다", () => {
    expect(linkColumns("class", described[3]!.columns)).toEqual(["from_class_id", "to_class_id"]);
    expect(linkColumns("student", described[1]!.columns)).toEqual(["student_id"]);
    expect(linkColumns("teacher", described[4]!.columns)).toEqual(["created_by"]);
    expect(linkColumns("teacher", described[1]!.columns)).toEqual(["taught_by", "recorded_by"]);
    expect(linkColumns("teacher", described[2]!.columns)).toEqual([]);
    expect(linkColumns("teacher", [col("handled_by"), col("checked_by"), col("approver_id"), col("revoked_by")])).toEqual(["handled_by", "checked_by", "approver_id"]);
    expect(linkColumns("class", [col("class_id", "text")])).toEqual([]);
  });

  it("날짜 칸은 '일이 일어난 날'부터(성적은 taken_on — 입력일 아님 · 비면 입력 시각으로) · 그다음 기간 칸(겹침) · 처리 시각은 안 쓴다 · 수업보고서는 coalesce", () => {
    expect(dateColumn(described[1]!.columns)).toEqual({ start: '"session_date"', end: null });
    expect(dateColumn(described[2]!.columns)).toEqual({ start: '"homework_date"', end: null });
    expect(dateColumn(described[5]!.columns)).toBeNull();
    expect(dateColumn(described[7]!.columns)).toEqual({ start: 'coalesce("taken_on", "created_at")', end: null });
    expect(dateColumn(described[6]!.columns)).toEqual({ start: '"start_date"', end: '"end_date"' });
    // 학부모 글 — 결석 기간(starts_on/ends_on · 출결 글이 아니면 비어 있다)보다 올린 날이 먼저(재리뷰 2026-11-09)
    expect(dateColumn(described[9]!.columns)).toEqual({ start: 'coalesce("posted_at", "created_at")', end: null });
    // 결재 대기(decided_at 비어 있음)도 기간에 든다 — 처리 시각 대신 입력 시각
    expect(dateColumn(described[10]!.columns)).toEqual({ start: '"created_at"', end: null });
    expect(dateColumn([col("covers_date", "date"), col("report_date", "date"), col("created_at", "timestamp with time zone")])).toEqual({
      start: 'coalesce("covers_date", "report_date")',
      end: null,
    });
  });

  it("반 — 이어진 표를 빠짐없이(영상 숙제 포함) · 반 자신은 id로 · 안 이어진 표는 뺀다", () => {
    const { tables } = surveyPlan("class", described, docs);
    expect(tables.map((p) => [p.table, p.links.join("/")])).toEqual([
      ["attendance_records", "class_id"],
      ["class_transfers", "from_class_id/to_class_id"],
      ["classes", "id"],
      ["enrollments", "class_id"],
      ["onto_class_teachers", "class_id"],
      ["video_homework_marks", "class_id"],
    ]);
    expect(tables.find((p) => p.table === "video_homework_marks")?.label).toBe("영상숙제 검사");
  });

  it("강사 — 이름 글자(teacher_name)로도 잇는다 · 내부 기록 표는 세지 않고 따로 · 맡은 반을 거친 표를 함께", () => {
    const { tables, internal } = surveyPlan("teacher", described, docs, { teacherName: "김윤하", withTaughtClasses: true });
    expect(tables.find((p) => p.key === "lesson_reports")?.links).toEqual(["created_by", "teacher_name"]);
    expect(tables.find((p) => p.key === "classes")?.links).toEqual(["teacher_id"]);
    expect(internal).toEqual(["push_subscriptions"]);
    expect(tables.some((p) => p.table === "push_subscriptions")).toBe(false);
    // 맡은 반을 거쳐 — 영상 숙제 검사(강사 칸 없음)도 들어간다
    const vh = tables.find((p) => p.key === "video_homework_marks@반");
    expect(vh).toMatchObject({ table: "video_homework_marks", via: "class", links: ["class_id"], label: "영상숙제 검사(맡은 반)" });
    expect(tables.find((p) => p.key === "attendance_records@반")?.via).toBe("class");
    // 맡은 반이 없으면 거쳐 가는 표는 없다
    expect(surveyPlan("teacher", described, docs, {}).tables.some((p) => p.via === "class")).toBe(false);
  });
});

describe("전수 조회 SQL — 비서 조회와 같은 검사기를 통과한다", () => {
  const views = new Set([...described.map((d) => d.table)]);
  it("UNION ALL 한 문장 · 검사 통과 · 끝 날짜 포함 · 이름 글자는 따옴표를 겹쳐 막는다 · 기간 칸은 겹침 · 맡은 반은 with 절(반 수와 무관하게 길이 일정)", async () => {
    const { tables } = surveyPlan("teacher", described, docs, { teacherName: "O'Brien", withTaughtClasses: true });
    const sql = surveySql(tables, { id: ID, from: "2026-05-01", to: "2026-11-06", teacherName: "O'Brien" });
    expect(sql).toContain(`"teacher_name" = 'O''Brien'`);
    expect(sql).toContain(`< date '2026-11-06' + 1`);
    expect(sql).toContain(`("end_date" is null or "end_date" >= date '2026-05-01')`);
    expect(sql.startsWith("with taught_classes as (select distinct t.class_id from onto_class_teachers t join classes c")).toBe(true);
    expect(sql).toContain(`"class_id" in (select class_id from taught_classes)`);
    expect(sql).toContain(`'video_homework_marks@반'::text as 표`);
    // 맡은 반 조건 — 맡은 기간이 겹치는 것 · 폐지·보강용 반 · 기간 전에 끝난 반 제외
    const taught = taughtClassesSql(ID, "2026-05-01", "2026-11-06");
    expect(taught).toContain("(t.valid_to is null or t.valid_to >= date '2026-05-01')");
    expect(taught).toContain("not coalesce(c.is_makeup_pool, false)");
    expect(taught).toContain("(c.closed_at is null or c.closed_at >= date '2026-05-01')");
    const gate = await checkAssistantSql(sql, views);
    expect(gate).toMatchObject({ ok: true });
    // 12개 묶음(실행기에 가는 크기) — 검사기 8,000자 안
    for (let i = 0; i < tables.length; i += 12) {
      const chunk = surveySql(tables.slice(i, i + 12), { id: ID, from: "2026-05-01", to: "2026-11-06", teacherName: "O'Brien" });
      expect(chunk.length).toBeLessThan(8000);
    }
    expect(await checkAssistantSql(`select count(*)::int as 반수 from (${taught}) x`, views)).toMatchObject({ ok: true });
  });
  it("id·날짜가 틀리면 SQL을 만들지 않는다 — 없는 날(2월 29일 · 평년) · 시작이 끝보다 늦음", () => {
    const { tables } = surveyPlan("class", described, docs);
    expect(() => surveySql(tables, { id: "1 or 1=1", from: "2026-05-01", to: "2026-11-06" })).toThrow();
    expect(() => surveySql(tables, { id: ID, from: "2026-5-1", to: "2026-11-06" })).toThrow();
    expect(() => surveySql(tables, { id: ID, from: "2026-02-01", to: "2026-02-29" })).toThrow(/있는 날짜/);
    expect(() => surveySql(tables, { id: ID, from: "2026-11-07", to: "2026-11-06" })).toThrow(/늦습니다/);
    expect(isRealYmd("2028-02-29")).toBe(true);
    expect(isRealYmd("2026-02-29")).toBe(false);
    expect(isRealYmd("2026-13-01")).toBe(false);
  });
});

const fakePlan = (names: string[]): SurveyTable[] => names.map((t) => ({ key: t, table: t, label: t, links: ["class_id"], date: { start: '"created_at"', end: null } }));
class QueryError extends Error {}
const okRows = (sql: string) => {
  const keys = [...sql.matchAll(/select '([a-z0-9_@반]+)'::text/g)].map((m) => m[1]!);
  return { columns: ["표", "전체", "기간", "최근"], rows: keys.map((t) => ({ 표: t, 전체: 5, 기간: t === "a_t" ? 2 : 0, 최근: "2026-11-01" })), rowCount: keys.length, truncated: false, ms: 1 };
};
const ARGS = { id: ID, from: "2026-05-01", to: "2026-11-06", isQueryError: (e: unknown) => e instanceof QueryError };

describe("전수 조회 실행 — 그 표 탓일 수 있는 오류만 쪼갠다 · 멈춤·상한", () => {
  it("한 표가 늘 막혀도 나머지는 센다", async () => {
    const db = {
      async run(sql: string) {
        if (sql.includes('"c_t"')) throw new QueryError("8초 안에 끝나지 않았습니다");
        return okRows(sql);
      },
    };
    const rows = await runSurvey(db, async (sql) => ({ ok: true, sql }), fakePlan(["a_t", "b_t", "c_t", "d_t"]), ARGS);
    expect(rows.map((r) => [r.table, r.inPeriod, r.failed ?? null])).toEqual([
      ["a_t", 2, null],
      ["b_t", 0, null],
      ["d_t", 0, null],
      ["c_t", null, "8초 안에 끝나지 않았습니다"],
    ]);
    const text = surveyForModel("class", "PS3A", "2026-05-01", "2026-11-06", rows, { internal: ["push_subscriptions"], notes: ["맡은 반 2개를 거친 자료도 셌다"] });
    expect(text).toContain("기간 안 자료 있음(1)");
    expect(text).toContain("세지 못함(1)");
    expect(text).toContain("하나도 빠짐없이");
    expect(text).toContain("내부 기록 표 1개는 뺐다");
    expect(text).toContain("맡은 반 2개를 거친 자료도 셌다");
  });

  it("연결·증표 같은 오류는 쪼개지 않고 바로 던진다(쪼개도 같다 — 수십 번 부르지 않게)", async () => {
    let calls = 0;
    const db = {
      async run() {
        calls += 1;
        throw new Error("connect timeout");
      },
    };
    await expect(runSurvey(db, async (sql) => ({ ok: true, sql }), fakePlan(Array.from({ length: 30 }, (_, i) => `t${i}_x`)), ARGS)).rejects.toThrow(/connect timeout/);
    expect(calls).toBe(1);
  });

  it("조회 오류가 이어져도 실행 횟수에 상한(묶음 수 × 9) — 남은 표는 '세지 못함'", async () => {
    let calls = 0;
    const db = {
      async run() {
        calls += 1;
        throw new QueryError("조회하지 못했습니다");
      },
    };
    const plan = fakePlan(Array.from({ length: 24 }, (_, i) => `t${String(i).padStart(2, "0")}_x`));
    const rows = await runSurvey(db, async (sql) => ({ ok: true, sql }), plan, ARGS);
    expect(calls).toBe(18);
    expect(rows).toHaveLength(24);
    expect(rows.every((r) => r.failed)).toBe(true);
  });

  it("멈춤·마무리(shouldStop)면 남은 묶음은 세지 않고 그 까닭으로 남긴다", async () => {
    let calls = 0;
    let stop: string | null = null;
    const db = {
      async run(sql: string) {
        calls += 1;
        stop = "시간이 다 돼 여기까지 봤습니다";
        return okRows(sql);
      },
    };
    const plan = fakePlan(Array.from({ length: 30 }, (_, i) => `t${String(i).padStart(2, "0")}_x`));
    const rows = await runSurvey(db, async (sql) => ({ ok: true, sql }), plan, { ...ARGS, shouldStop: () => stop });
    expect(calls).toBe(1);
    expect(rows.filter((r) => !r.failed)).toHaveLength(12);
    expect(rows.filter((r) => r.failed === "시간이 다 돼 여기까지 봤습니다")).toHaveLength(18);
  });
});

describe("확인한 자료 범위", () => {
  const row = (table: string, total: number, inPeriod: number): SurveyRow => ({ key: table, table, label: table, links: ["class_id"], total, inPeriod, latest: "2026-11-01" });
  it("자료 있는 표만 · 온톨로지 보기로 본 것은 원본도 '내용 조회' · 원본 하나를 거른 보기는 원본을 봐도", () => {
    const cov = coverageOf([
      {
        target: "class",
        name: "PS3A",
        from: "2026-05-01",
        to: "2026-11-06",
        id: ID,
        rows: [row("attendance_records", 300, 120), row("video_homework_marks", 40, 12), row("class_transfers", 0, 0), row("onto_enrollments", 20, 20)],
        examined: new Set(["onto_attendance", "enrollments"]),
      },
    ]);
    expect(cov.surveys[0]).toMatchObject({ target: "반", checked: 4 });
    expect(cov.surveys[0]!.tables.map((t) => [t.table, t.examined])).toEqual([
      ["attendance_records", true],
      ["video_homework_marks", false],
      ["onto_enrollments", true],
    ]);
  });

  it("🔴 여러 원본을 합친 보기(반 담당)는 classes를 봤다고(반 id 찾기) '내용 조회'이 되지 않는다 · 전수 조회마다 그 뒤 조회만", () => {
    const cov = coverageOf([
      { target: "class", id: ID, name: "A", from: "2026-05-01", to: "2026-11-06", rows: [row("onto_class_teachers", 3, 3), row("classes", 1, 1)], examined: new Set(["classes"]) },
      { target: "class", id: ID, name: "B", from: "2026-05-01", to: "2026-11-06", rows: [row("classes", 1, 1)], examined: new Set() },
    ]);
    expect(cov.surveys[0]!.tables.map((t) => [t.table, t.examined])).toEqual([
      ["onto_class_teachers", false],
      ["classes", true],
    ]);
    expect(cov.surveys[1]!.tables[0]!.examined).toBe(false);
  });

  it("한국 날짜 · 며칠 앞", () => {
    expect(kstYmd(Date.parse("2026-11-06T16:00:00Z"))).toBe("2026-11-07");
    expect(addDays("2026-11-06", -180)).toBe("2026-05-10");
  });
});
