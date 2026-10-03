import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { notYetStartedStudentIds } from "@/features/students/enrolled-composition";
import { retentionNotStartedStudentIds, type RetentionEnrollmentSpan } from "./not-started";

/**
 * 리텐션 명단의 '실시간 재원생'(2026-10-03 운영점검 합의 A02) — 원생목록과 같은 판정으로 맞춘다.
 * 다섯 고정 사례: 수강 없음 / 미래만 / 미래 + 시작 / 종료 + 미래 / 휴원 중만.
 */
const TODAY = "2026-10-03";
const row = (student: string, p: Partial<RetentionEnrollmentSpan> = {}): RetentionEnrollmentSpan => ({
  student_id: student,
  start_date: "2026-03-02",
  end_date: null,
  on_hold: false,
  ...p,
});

describe("리텐션에서 뺄 '아직 한 과목도 시작 안 한' 재원생 — 다섯 사례", () => {
  it("① 수강이 아예 없는 재원생은 남는다(반 배정 전 신입 — 뺄 근거가 없다)", () => {
    expect(retentionNotStartedStudentIds([], TODAY).has("none")).toBe(false);
    expect(retentionNotStartedStudentIds([row("other")], TODAY).has("none")).toBe(false);
  });

  it("② 미래 시작 수강만 있으면 빠진다", () => {
    const out = retentionNotStartedStudentIds(
      [row("future", { start_date: "2026-10-06" }), row("future", { start_date: "2026-11-01" })],
      TODAY,
    );
    expect([...out]).toEqual(["future"]);
  });

  it("③ 미래 시작 + 이미 시작한 수강이 하나라도 있으면 남는다", () => {
    const out = retentionNotStartedStudentIds(
      [row("mixed", { start_date: "2026-10-06" }), row("mixed", { start_date: "2026-09-01" })],
      TODAY,
    );
    expect(out.has("mixed")).toBe(false);
  });

  it("④ 끝난 수강 + 미래 시작 수강이면 빠진다 — 끝난 수강을 '이미 시작'으로 읽지 않는다", () => {
    const out = retentionNotStartedStudentIds(
      [
        row("ended-future", { start_date: "2026-03-02", end_date: "2026-08-31" }),
        row("ended-future", { start_date: "2026-10-06" }),
      ],
      TODAY,
    );
    expect(out.has("ended-future")).toBe(true);
  });

  it("⑤ 휴원 중인 수강만 있으면 남는다(휴원 수강은 재료가 아니다)", () => {
    const out = retentionNotStartedStudentIds(
      [row("on-hold", { on_hold: true }), row("on-hold", { on_hold: true, start_date: "2026-10-06" })],
      TODAY,
    );
    expect(out.has("on-hold")).toBe(false);
  });
});

describe("경계", () => {
  it("오늘 시작하는 수강은 이미 시작한 것이다", () => {
    expect(retentionNotStartedStudentIds([row("today", { start_date: TODAY })], TODAY).size).toBe(0);
    expect(retentionNotStartedStudentIds([row("tomorrow", { start_date: "2026-10-04" })], TODAY).has("tomorrow")).toBe(true);
  });

  it("시작일을 모르는 수강은 시작한 것으로 본다 — 모름을 '미시작'으로 읽지 않는다", () => {
    expect(retentionNotStartedStudentIds([row("unknown", { start_date: null })], TODAY).size).toBe(0);
    expect(retentionNotStartedStudentIds([{ student_id: "unknown", end_date: null, on_hold: false }], TODAY).size).toBe(0);
  });

  it("휴원 여부를 모르는 줄(null)은 재료에서 뺀다 — 원생목록 조회(on_hold = false)와 같은 조건", () => {
    expect(retentionNotStartedStudentIds([row("x", { on_hold: null, start_date: "2026-10-06" })], TODAY).size).toBe(0);
  });

  it("시작일에 시각이 붙어 와도 날짜로 비교한다", () => {
    expect(
      retentionNotStartedStudentIds([row("ts", { start_date: "2026-10-06T00:00:00+09:00" })], TODAY).has("ts"),
    ).toBe(true);
  });

  it("미래에 끝나는 예약 종료 수강(end_date 있음)만 가진 학생은 남는다 — 원생목록과 같은 재료 조건", () => {
    expect(
      retentionNotStartedStudentIds([row("ending", { start_date: "2026-03-02", end_date: "2026-10-31" })], TODAY).size,
    ).toBe(0);
  });
});

describe("원생목록과 같은 함수·같은 집합", () => {
  it("활성 수강(종료 안 됨 · 휴원 아님)만 넘긴 원생목록 판정과 결과가 같다", () => {
    const all: RetentionEnrollmentSpan[] = [
      row("future", { start_date: "2026-10-06" }),
      row("mixed", { start_date: "2026-10-06" }),
      row("mixed", { start_date: "2026-09-01" }),
      row("ended-future", { start_date: "2026-03-02", end_date: "2026-08-31" }),
      row("ended-future", { start_date: "2026-10-06" }),
      row("on-hold", { on_hold: true, start_date: "2026-10-06" }),
      row("started"),
    ];
    // 원생목록은 SQL로 end_date is null · on_hold = false를 건 뒤 같은 함수를 부른다.
    const listView = notYetStartedStudentIds(
      all.filter((e) => e.end_date === null && e.on_hold === false),
      TODAY,
    );
    expect([...retentionNotStartedStudentIds(all, TODAY)].sort()).toEqual([...listView].sort());
    expect([...listView].sort()).toEqual(["ended-future", "future"]);
  });

  it("조회·판정 배선 — 리텐션이 시작일을 받아 KST 오늘로 같은 함수를 부른다", () => {
    const src = readFileSync(join(process.cwd(), "src/features/retention/server/queries.ts"), "utf8");
    expect(src).toMatch(/\.select\("student_id, start_date, end_date, on_hold,/);
    expect(src).toMatch(/retentionNotStartedStudentIds\(\s*enrollments as [\s\S]{0,200}?,\s*kstToday\(\),\s*\)/);
    // 강사 범위는 **뺀 뒤의** 명단에 건다 — 범위마다 다른 집합이 빠지지 않게.
    expect(src).toMatch(/\? startedStudents\.filter\(\(s\) => teacherIdsByStudent\.get\(s\.id\)\?\.has\(teacherId\)\)\s*: startedStudents;/);
    // 조회에서 시작일로 거르지 않는다(미래 시작 수강만 가진 학생을 알아내려면 그 줄도 받아야 한다).
    expect(src).not.toMatch(/\.lte\("start_date"/);
  });
});
