import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentFact } from "@/features/students/ontology/types";
import { emptyRaws } from "../model/config";
import { emptyPayload } from "../model/stored";
import { loadStudentDisplayMonths } from "./student-months";

const fact = (id: string, studentId = "s", access: StudentFact["access"] = "student"): StudentFact => ({
  id, studentId, tenantId: "t", kind: "attendance", value: { status: "present" }, access, basis: "recorded", state: "active",
  occurred: { precision: "day", value: "2026-10-01" }, recordedAt: "2026-10-02", related: [],
  evidence: [{ source: "attendance_records", id, studentId }],
});
const summary = (month: string, student_id = "s") => ({ student_id, month, raws: { ...emptyRaws(), subjectMonths: 1 },
  correction: emptyRaws(), unavailable: [], closed_at: null, reconstructed: false, computed_at: "2026-10-02",
  correction_reasons: [{ metric: "subjectMonths", delta: 1, reason: "source" }] });
function database(summaries = [summary("2026-09"), summary("2026-10")], fail = false, freshSubjects = 1) {
  const calls: { columns: string; filters: Record<string, unknown> }[] = [];
  const db = { from: () => {
    const call = { columns: "", filters: {} as Record<string, unknown> }; calls.push(call);
    const q = { select: (s: string) => { call.columns = s; return q; }, eq: (k: string, v: string) => { call.filters[k] = v; return q; },
      in: (k: string, v: string[]) => { call.filters[k] = v; return q; }, order: () => q, range: () => { const result = { error: fail ? { message: "offline" } : null,
        data: call.columns.includes("correction_reasons") ? summaries : [
          ...(summaries.some((s) => s.student_id === "s" && s.month === call.filters.month) ? [{ ...summary(String(call.filters.month)), raws: { ...emptyRaws(), subjectMonths: freshSubjects }, payload: { ...emptyPayload(), facts: [fact("same"), fact("bill", "s", "billing")] } }] : []),
          { student_id: "old", computed_at: "2026-10-03", payload: { ...emptyPayload(), facts: [fact("same", "old")] } },
        ] }; return Object.assign(Promise.resolve(result), { returns: () => Promise.resolve(result) }); } };
    return q;
  } } as unknown as SupabaseClient;
  return { db, calls };
}
describe("선택한 달의 원본만 읽는 학생 상세", () => {
  it("끊긴 원본 연결은 해당 근거만 보류하고 월 점수는 유지한다", async () => {
    const { db } = database();
    const canonical = (id: string) => { if (id === "old") throw new Error("missing target"); return id; };
    const months = await loadStudentDisplayMonths(db, "t", "s", ["s", "old"], "2026-10", canonical, null);
    const selected = months.at(-1)!;
    expect(selected.withheldFacts).toBe(1); expect(selected.raws.subjectMonths).toBe(1);
    expect(selected.payload.facts.map((f) => f.id)).toEqual(["bill"]);
  });
  it("병합 후 학생의 권한으로 병합 전 원문을 열지 않는다", async () => {
    const { db } = database();
    const months = await loadStudentDisplayMonths(db, "t", "s", ["s", "old"], "2026-10", () => "s", new Set(["s"]));
    expect(months.at(-1)!.payload.facts.every((f) => f.evidence.every((e) => e.studentId !== "old"))).toBe(true);
    expect(months.at(-1)!.raws.subjectMonths).toBe(1);
  });
  it("모든 달의 점수·정정은 보존하고 선택한 달만 근거를 합친다", async () => {
    const { db, calls } = database();
    const months = await loadStudentDisplayMonths(db, "t", "s", ["s", "old"], "2026-09", () => "s", null);
    expect(months.map((m) => m.raws.subjectMonths)).toEqual([1, 1]);
    expect(months[1]!.payload.facts).toEqual([]);
    expect(months[1]!.payload.correctionReasons).toHaveLength(1);
    expect(months[0]!.payload.facts).toHaveLength(2);
    expect(months[0]!.payload.facts[0]!.evidence[0]!.studentId).toBe("old");
    expect(calls[0]!.columns).not.toMatch(/\b(payload|historical),/);
    expect(calls[1]!.filters).toEqual({ tenant_id: "t", month: "2026-09", student_id: ["s", "old"] });
  });
  it("알 수 없는 달은 최신 달로 돌아가고 제한된 원본을 제외한다", async () => {
    const { db, calls } = database();
    const months = await loadStudentDisplayMonths(db, "t", "s", ["s", "old"], "2099-01", () => "s", new Set());
    expect(calls[1]!.filters.month).toBe("2026-10");
    expect(months.at(-1)!.payload.facts.map((f) => f.id)).toEqual(["bill"]);
  });
  it("병합 전 원생에게만 있는 달은 근거를 보여주되 점수를 중복하지 않는다", async () => {
    const { db } = database([summary("2026-09", "old"), summary("2026-10")]);
    const months = await loadStudentDisplayMonths(db, "t", "s", ["s", "old"], "2026-09", () => "s", null);
    expect(months[0]!.raws).toEqual(emptyRaws());
    expect(months[0]!.computedAt).toBe("");
    expect(months[0]!.payload.facts).toHaveLength(1);
  });
  it("조회 도중 집계가 바뀌면 선택한 달의 수치와 근거를 같은 저장본으로 맞춘다", async () => {
    const { db } = database(undefined, false, 3);
    const months = await loadStudentDisplayMonths(db, "t", "s", ["s", "old"], "2026-10", () => "s", null);
    expect(months[0]!.raws.subjectMonths).toBe(1);
    expect(months[1]!.raws.subjectMonths).toBe(3);
    expect(months[1]!.payload.facts).toHaveLength(2);
  });
  it("빈 기록은 추가 조회하지 않으며 조회 실패를 0으로 숨기지 않는다", async () => {
    const { db, calls } = database([]);
    expect(await loadStudentDisplayMonths(db, "t", "s", ["s"], undefined, (id) => id, null)).toEqual([]);
    expect(calls).toHaveLength(1);
    await expect(loadStudentDisplayMonths(database([], true).db, "t", "s", ["s"], undefined, (id) => id, null)).rejects.toThrow("offline");
  });
});
