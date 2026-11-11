import { describe, expect, it } from "vitest";
import { buildEmployedOn, buildEvalHomeroomHistory, evalHomeroomOnDate, kstDay, mergeHomeroomChanges, type ActivityTeacherChange, type AuditChange } from "./homeroom-history";

const act = (classId: string, at: string, oldTeacherId: string | null, newTeacherId: string | null): ActivityTeacherChange =>
  ({ classId, at, oldTeacherId, newTeacherId });
const audit = (classId: string, date: string, teacherId: string, previousTeacherId: string | null = null): AuditChange =>
  ({ classId, date, teacherId, previousTeacherId });

describe("mergeHomeroomChanges — 감사로그 + activity_log", () => {
  it("감사로그에 없는 교체를 activity로 채운다(처리일 = 한국 날짜)", () => {
    // 실데이터: 초등M 초6 JJ2B — 8/3 이유정→허은진, 9/1 허은진→허주연(감사로그 0건)
    const merged = mergeHomeroomChanges([], [act("JJ2B", "2026-08-02T23:30:00Z", "이유정", "허은진"), act("JJ2B", "2026-09-01T02:00:00Z", "허은진", "허주연")]);
    expect(merged).toEqual([
      { classId: "JJ2B", date: "2026-08-03", teacherId: "허은진", previousTeacherId: "이유정" },
      { classId: "JJ2B", date: "2026-09-01", teacherId: "허주연", previousTeacherId: "허은진" },
    ]);
  });
  it("같은 반·같은 새 담임·3일 안이면 감사로그(적용일) 하나와만 짝짓고 activity는 버린다", () => {
    const merged = mergeHomeroomChanges([audit("A", "2026-10-01", "B")], [act("A", "2026-09-29T03:00:00Z", "X", "B")]);
    expect(merged).toEqual([audit("A", "2026-10-01", "B")]);
  });
  it("오간 변경(A→B→A→B)은 짝을 하나씩만 — 서로 먹지 않는다", () => {
    const merged = mergeHomeroomChanges([audit("C", "2026-09-01", "B")], [act("C", "2026-09-01T01:00:00Z", "A", "B"), act("C", "2026-09-02T01:00:00Z", "B", "A"), act("C", "2026-09-03T01:00:00Z", "A", "B")]);
    expect(merged.map((m) => `${m.date}:${m.teacherId}`)).toEqual(["2026-09-01:B", "2026-09-02:A", "2026-09-03:B"]);
  });
  it("값이 그대로인 줄 · 둘 다 빈 줄은 변경이 아니다 · 담임을 비운 변경은 남긴다", () => {
    const merged = mergeHomeroomChanges([], [act("D", "2026-07-13T01:00:00Z", "X", "X"), act("D", "2026-07-13T01:00:00Z", null, null), act("D", "2026-07-13T02:00:00Z", "신명진", null)]);
    expect(merged).toEqual([{ classId: "D", date: "2026-07-13", teacherId: null, previousTeacherId: "신명진" }]);
  });
  it("🔴 빈 담임 칸을 채운 변경(old=null)은 교체가 아니다 — 끝난 반에 7/22 담임을 채운 정정 · 반 생성", () => {
    expect(mergeHomeroomChanges([], [act("LT1", "2026-07-22T01:00:00Z", null, "김태건"), act("BS3E", "2026-07-20T01:00:00Z", null, "남정화")])).toEqual([]);
  });
  it("한국 날짜", () => {
    expect(kstDay("2026-08-31T15:30:00Z")).toBe("2026-09-01");
    expect(kstDay("bad")).toBe("");
  });
});

describe("evalHomeroomOnDate — 이력이 있으면 지금 담임을 거슬러 붙이지 않는다", () => {
  const history = buildEvalHomeroomHistory([
    { classId: "JJ2B", date: "2026-08-03", teacherId: "허은진", previousTeacherId: "이유정" },
    { classId: "JJ2B", date: "2026-09-01", teacherId: "허주연", previousTeacherId: "허은진" },
  ]).get("JJ2B");
  it("구간마다 그때 담임", () => {
    expect(evalHomeroomOnDate(history, "허주연", "2026-04-15")).toBe("이유정");
    expect(evalHomeroomOnDate(history, "허주연", "2026-08-20")).toBe("허은진");
    expect(evalHomeroomOnDate(history, "허주연", "2026-09-01")).toBe("허주연");
  });
  it("이력이 없는 반은 지금 담임", () => {
    expect(evalHomeroomOnDate(undefined, "남정화", "2026-04-01")).toBe("남정화");
  });
  it("첫 기록의 이전 담임을 모르면 그 전은 모름(null)", () => {
    const h = buildEvalHomeroomHistory([{ classId: "N", date: "2026-07-22", teacherId: "이수연", previousTeacherId: null }]).get("N");
    expect(evalHomeroomOnDate(h, "이수연", "2026-07-01")).toBeNull();
    expect(evalHomeroomOnDate(h, "이수연", "2026-07-22")).toBe("이수연");
  });
  it("담임을 비운 구간은 담임 없음", () => {
    const h = buildEvalHomeroomHistory([{ classId: "E", date: "2026-07-13", teacherId: null, previousTeacherId: "신명진" }, { classId: "E", date: "2026-07-29", teacherId: "전양원", previousTeacherId: null }]).get("E");
    expect(evalHomeroomOnDate(h, "전양원", "2026-07-01")).toBe("신명진");
    expect(evalHomeroomOnDate(h, "전양원", "2026-07-20")).toBeNull();
    expect(evalHomeroomOnDate(h, "전양원", "2026-08-01")).toBe("전양원");
  });
});

describe("buildEmployedOn — 입사 전·퇴사 뒤는 아니다", () => {
  const employed = buildEmployedOn(new Map([["허주연", { hireDate: "2026-09-01", resignDate: null }], ["정은지", { hireDate: "2025-07-07", resignDate: "2026-10-31" }]]));
  it("입사일·퇴사일 경계 포함", () => {
    expect(employed("허주연", "2026-08-31")).toBe(false);
    expect(employed("허주연", "2026-09-01")).toBe(true);
    expect(employed("정은지", "2026-10-31")).toBe(true);
    expect(employed("정은지", "2026-11-01")).toBe(false);
  });
  it("입사일보다 앞선 퇴사일(재입사 전 옛 퇴사)은 지금 재직을 자르지 않는다", () => {
    const rehired = buildEmployedOn(new Map([["김화영", { hireDate: "2026-01-16", resignDate: "2023-02-28" }]]));
    expect(rehired("김화영", "2026-05-15")).toBe(true);
    expect(rehired("김화영", "2025-12-31")).toBe(false);
  });
  it("재직 정보가 없는 사람은 자르지 않는다", () => {
    expect(employed("모름", "2020-01-01")).toBe(true);
  });
});
