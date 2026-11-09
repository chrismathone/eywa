import { describe, expect, it } from "vitest";
import { checkAssistantSql } from "./sql-gate";
import type { Row } from "./agent";
import { countSignals, SIGNAL_SQL, signalFromRow } from "./suggestion-signals";

const VIEWS = new Set([
  "students",
  "onto_attendance",
  "onto_students",
  "onto_enrollments",
  "classes",
  "invoices",
  "student_consultations",
  "enrollment_consultations",
  "school_exam_periods",
]);

describe("추천 질문 신호 SQL", () => {
  it("모든 신호 SQL이 비서 SQL 검사를 통과한다(SELECT 한 문장 · 보기 이름만)", async () => {
    for (const [name, sql] of Object.entries(SIGNAL_SQL)) {
      const gate = await checkAssistantSql(sql, VIEWS);
      expect(gate.ok, `${name}: ${gate.ok ? "" : gate.reason}`).toBe(true);
    }
  });

  it("조회 한 줄 → 신호(문자 숫자 · 빈 줄 · 반 이름 없음)", () => {
    expect(signalFromRow("unpaid", { count: 10, won: "948750", old: 2 })).toEqual({ count: 10, won: 948_750, old: 2 });
    expect(signalFromRow("absence", undefined)).toBeUndefined();
    expect(signalFromRow("classDrop", { class_name: " ", n0: 1, p0: 1, n1: 1, p1: 1 })).toBeUndefined();
    expect(signalFromRow("exams", { schools: 0, earliest: null })).toEqual({ schools: 0, earliest: null });
    expect(signalFromRow("consult", { no_recent: 72, overdue: null })).toEqual({ noRecent: 72, overdue: 0 });
  });

  it("신호 하나가 실패해도 나머지는 센다", async () => {
    const db = {
      views: async () => VIEWS,
      run: async (sql: string) => {
        if (sql.includes("onto_attendance")) throw new Error("8초 안에 끝나지 않았습니다");
        const row: Row | null = sql.includes("invoices") ? { count: 3, won: 50_000, old: 0 } : sql.includes("withdrawn_on") ? { this_month: 2, prev6: 6, scheduled: 0 } : null;
        return { columns: [] as string[], rows: row ? [row] : [], rowCount: row ? 1 : 0, truncated: false, ms: 1 };
      },
    };
    const { signals, failed } = await countSignals(db);
    expect(failed).toEqual(expect.arrayContaining(["absence", "classDrop"]));
    expect(signals.unpaid).toEqual({ count: 3, won: 50_000, old: 0 });
    expect(signals.withdrawals).toEqual({ thisMonth: 2, prev6: 6, scheduled: 0 });
    expect(signals.absence).toBeUndefined();
    expect(failed).not.toContain("unpaid");
  });
});
