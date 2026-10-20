import { describe, expect, it } from "vitest";
import { enrolledOn, monthlyPoints, subjectTrendOf, yearlyPoints, type TrendStudent } from "./enrolled-trend";

const s = (id: string, status: string, enrolledAt: string | null, withdrawnAt: string | null = null): TrendStudent => ({ id, status, enrolledAt, withdrawnAt });

describe("재원생 추이 — 그날의 재원생(원장 2026-09-29)", () => {
  const students = [
    s("a", "enrolled", "2026-01-10"),
    s("b", "withdrawn", "2025-12-01", "2026-03-15"),
    s("c", "enrolled", "2026-09-01"), // 첫 수강이 10/1 — 아직 시작 전
    s("d", "on_hold", "2025-01-01"), // 휴원은 카드도 안 센다
    s("e", "prospect", "2025-01-01"),
    s("f", "enrolled", "2026-02-01", "2026-10-01"), // 퇴원 예약 — 그날 전까지 재원
    s("g", "withdrawn", "2025-01-01", "2026-07-10"), // 시스템 정리(수강 이력 없음) — 뺀다
  ];
  const first = new Map([["a", "2026-01-12"], ["b", "2025-12-02"], ["c", "2026-10-01"], ["f", "2026-02-02"]]);
  it("퇴원일 전까지·첫 수강 시작 뒤만 센다", () => {
    const en = { firstStart: first, ended: new Set<string>() };
    expect(enrolledOn(students, en, "2026-02-28")).toBe(3); // a b f
    expect(enrolledOn(students, en, "2026-03-15")).toBe(2); // 퇴원일 당일부터 빠진다
    expect(enrolledOn(students, en, "2026-09-29")).toBe(2); // c는 시작 전
    expect(enrolledOn(students, en, "2026-10-01")).toBe(2); // f 퇴원 · c 시작
  });
  it("병합으로 흡수된 학생은 빼고, 등록일이 빈 재원생은 센다(카드와 같게)", () => {
    const en = { firstStart: new Map<string, string>(), ended: new Set<string>() };
    const merged = { ...s("m", "withdrawn", "2025-07-15", "2026-07-07"), notes: "중복 병합: abc와 통합됨" };
    expect(enrolledOn([merged], en, "2026-01-01")).toBe(0);
    // 운영 원본은 메모 칸 대신 병합 판정 값을 싣는다(적대 재리뷰 2026-10-20) — 그 값만으로도 뺀다.
    expect(enrolledOn([{ ...s("m2", "withdrawn", "2025-07-15", "2026-07-07"), merged: true }], en, "2026-01-01")).toBe(0);
    expect(enrolledOn([s("n", "enrolled", null)], en, "2026-09-29")).toBe(1);
  });
  it("🔴 수업 기록 없는 장부 정리는 정리한 날 전에도 세지 않는다 — 수업 기록이 있으면 퇴원일까지 센다(원장 2026-10-15)", () => {
    const none = { firstStart: new Map<string, string>(), ended: new Set<string>() };
    const cleaned = { ...s("k", "withdrawn", "2026-06-22", "2026-07-08"), cleanup: true };
    expect(enrolledOn([cleaned], none, "2026-07-01")).toBe(0);
    const taught = { firstStart: new Map([["k", "2026-06-23"]]), ended: new Set(["k"]) };
    expect(enrolledOn([cleaned], taught, "2026-07-01")).toBe(1);
    expect(enrolledOn([cleaned], taught, "2026-07-08")).toBe(0);
    // 다시 등록하면 재원으로 센다(메모가 남아 있어도 퇴원 학생이 아니다).
    expect(enrolledOn([{ ...cleaned, status: "enrolled", withdrawnAt: null }], none, "2026-07-01")).toBe(1);
  });
  it("월별 12칸 — 이번 달은 오늘, 연도별 — 올해는 오늘", () => {
    const m = monthlyPoints("2026-09-29");
    expect(m).toHaveLength(12);
    expect(m[0]).toMatchObject({ key: "2025-10", date: "2025-10-31" });
    expect(m[11]).toMatchObject({ key: "2026-09", date: "2026-09-29" });
    expect(yearlyPoints("2026-09-29", 2025).map((p) => p.date)).toEqual(["2025-12-31", "2026-09-29"]);
  });
});

describe("과목별 재원생 추이(원장 2026-10-14 2단계)", () => {
  const students = [
    s("m", "enrolled", "2026-01-01"), // 수학만
    s("both", "enrolled", "2026-01-01"), // 영어+수학
    s("moved", "enrolled", "2026-01-01"), // 영어 → 수학(반이동 2026-05-01)
    s("new", "enrolled", "2026-04-01"), // 반 배정 전(수강 기록 없음)
    s("done", "enrolled", "2026-01-01"), // 영어 수강이 4/15에 끝났는데 재원(미수강)
  ];
  const en = { firstStart: new Map([["m", "2026-01-02"], ["both", "2026-01-02"], ["moved", "2026-01-02"], ["done", "2026-01-02"]]), ended: new Set(["moved", "done"]) };
  const enrollments = [
    { studentId: "m", subject: "math", start: "2026-01-02", end: null, transferred: false },
    { studentId: "both", subject: "math", start: "2026-01-02", end: null, transferred: false },
    { studentId: "both", subject: "english", start: "2026-01-02", end: null, transferred: false },
    { studentId: "moved", subject: "english", start: "2026-01-02", end: "2026-05-01", transferred: true },
    { studentId: "moved", subject: "math", start: "2026-05-01", end: null, transferred: false },
    { studentId: "done", subject: "english", start: "2026-01-02", end: "2026-04-15", transferred: false },
  ];
  const points = [
    { key: "2026-03", label: "3월", date: "2026-03-31" },
    { key: "2026-05", label: "5월", date: "2026-05-31" },
  ];
  it("그날 그 과목 반에 수강이 걸린 재원생 + 끝나지 않은 수강이 없는 재원생(모름 — 모두에게) — 두 과목이면 양쪽에", () => {
    const math = subjectTrendOf(students, en, enrollments, points, (x) => x === "math" || x === null);
    const english = subjectTrendOf(students, en, enrollments, points, (x) => x === "english" || x === null);
    expect(math.map((p) => p.count)).toEqual([2, 5]); // 3월: m·both / 5월: m·both·moved·new·done
    expect(english.map((p) => p.count)).toEqual([3, 3]); // 3월: both·moved·done / 5월: both·new·done(moved는 4/30까지)
  });

  it("아직 시작 안 한 수강만 남은 학생은 어느 과목에도 안 든다 — 시작일이 비면 시작한 것", () => {
    const later = [s("wait", "enrolled", "2026-01-01"), s("blank", "enrolled", "2026-01-01")];
    const enLater = { firstStart: new Map([["wait", "2026-01-02"]]), ended: new Set(["wait"]) };
    const rows = [
      { studentId: "wait", subject: "english", start: "2026-01-02", end: "2026-02-28", transferred: false },
      { studentId: "wait", subject: "math", start: "2026-06-01", end: null, transferred: false },
      { studentId: "blank", subject: "math", start: null, end: null, transferred: false },
    ];
    const at = [{ key: "2026-05", label: "5월", date: "2026-05-31" }];
    expect(subjectTrendOf(later, enLater, rows, at, (x) => x === "math" || x === null)[0]!.count).toBe(1); // blank만
    expect(subjectTrendOf(later, enLater, rows, at, (x) => x === "english" || x === null)[0]!.count).toBe(0);
  });

  it("오늘 점은 KPI 규약 — 종료일이 박힌 수강은 끝난 것(반이동 예약·미래 종료일), 지난 날짜는 그날 걸렸는지로", () => {
    const one = [s("x", "enrolled", "2026-01-01")];
    const enX = { firstStart: new Map([["x", "2026-01-02"]]), ended: new Set(["x"]) };
    const rows = [
      { studentId: "x", subject: "english", start: "2026-01-02", end: null, transferred: false },
      { studentId: "x", subject: "math", start: "2026-01-02", end: "2026-10-20", transferred: false },
    ];
    const at = [{ key: "2026-09", label: "9월", date: "2026-09-30" }, { key: "2026-10", label: "10월", date: "2026-10-14" }];
    const math = (x: string | null) => x === "math" || x === null;
    expect(subjectTrendOf(one, enX, rows, at, math, "2026-10-14").map((p) => p.count)).toEqual([1, 0]);
    expect(subjectTrendOf(one, enX, rows, at, math).map((p) => p.count)).toEqual([1, 1]); // 오늘을 안 주면 날짜 판정 그대로
  });
});
