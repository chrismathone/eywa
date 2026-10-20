import { describe, expect, it } from "vitest";
import { coverageStartFromCounts, startedRegistration, trustedFrom } from "./coverage-rules";

describe("coverageStartFromCounts — 청구가 지점을 덮기 시작한 달", () => {
  const counts = (o: Record<string, number>) => new Map(Object.entries(o));
  it("옛 달 낱장 청구·오타 청구월은 건너뛴다(3건 · 그 뒤 6개월 중 가장 많은 달의 20% · 창 전체의 5% · 석 달 이어서)", () => {
    expect(coverageStartFromCounts(counts({ "2016-03": 1, "2024-02": 1, "2025-12": 1, "2026-01": 389, "2026-02": 400, "2026-03": 427 }), "2026-10")).toBe("2026-01");
  });
  it("🔴 학생이 계속 늘어난 지점도 시작 달이 뒤로 밀리지 않는다(demo 50→164 · 3년 뒤 40→250) · 청구가 없으면 null", () => {
    expect(coverageStartFromCounts(counts({ "2026-04": 50, "2026-05": 81, "2026-06": 112, "2026-07": 128, "2026-08": 144, "2026-09": 164 }), "2026-10")).toBe("2026-04");
    const grown: Record<string, number> = {};
    for (let i = 0; i < 36; i++) grown[new Date(Date.UTC(2026, i, 1)).toISOString().slice(0, 7)] = 40 + i * 6;
    expect(coverageStartFromCounts(counts(grown), "2028-12")).toBe("2026-01"); // 창 전체 20% 기준이면 40 < 250×20% → 몇 달 뒤로 밀렸다
    expect(coverageStartFromCounts(new Map(), "2026-10")).toBeNull();
  });
  it("🔴 몇 건짜리 시범 청구 달·한 번 청구하고 멈춘 달은 시작 달이 아니다(적대 재리뷰 2026-10-20) · 외딴 달도", () => {
    const real = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`2026-${String(i + 1).padStart(2, "0")}`, 400]));
    expect(coverageStartFromCounts(counts({ "2025-03": 3, "2025-04": 4, ...real }), "2026-10")).toBe("2026-01");
    expect(coverageStartFromCounts(counts({ "2025-12": 5 }), "2026-10")).toBeNull();
    expect(coverageStartFromCounts(counts({ "2023-05": 5, "2026-01": 389, "2026-02": 400, "2026-03": 410 }), "2026-10")).toBe("2026-01");
  });
  it("이제 막 청구를 시작한 지점 — 이번 달·지난달 시작도 그 달(이번 달은 아직 청구 중일 수 있어 잇기를 보지 않는다)", () => {
    expect(coverageStartFromCounts(counts({ "2026-10": 12 }), "2026-10")).toBe("2026-10");
    expect(coverageStartFromCounts(counts({ "2026-09": 30 }), "2026-10")).toBe("2026-09");
    expect(coverageStartFromCounts(counts({ "2026-08": 30, "2026-09": 32 }), "2026-10")).toBe("2026-08");
    // 0건 달까지 넘겨도(장부 정리 청구 판정의 입력) 결과가 같다.
    expect(coverageStartFromCounts(counts({ "2026-08": 30, "2026-09": 32, "2026-10": 0 }), "2026-10")).toBe("2026-08");
  });
});

describe("trustedFrom — 에이와 수강 기록이 갖춰진 첫 달(원장 2026-10-20 '2026년 4월부터')", () => {
  // 달마다 청구 학생 n명 — 그중 그달 말까지 수강 시작 기록이 없는(첫 수강이 그 뒤) 학생 수를 달리 둔다.
  const scenario = (lateByMonth: Record<string, [number, number]>) => {
    const bills: { student_id: string; period: string }[] = [];
    const firstStart = new Map<string, string>();
    for (const [month, [n, late]] of Object.entries(lateByMonth)) {
      for (let i = 0; i < n; i++) {
        const id = `${month}-${i}`;
        bills.push({ student_id: id, period: month });
        firstStart.set(id, i < late ? "2026-12-01" : `${month}-01`);
      }
    }
    return { bills, firstStart };
  };
  it("늦게 잡힌 학생이 3% 밑으로 내려간 첫 달(침산: 1월 13% · 2월 8% · 3월 5% → 4월 1%)", () => {
    const { bills, firstStart } = scenario({ "2026-01": [100, 13], "2026-02": [100, 8], "2026-03": [100, 5], "2026-04": [100, 1] });
    expect(trustedFrom(bills, firstStart, "2026-01", "2026-10", "2023-11")).toBe("2026-04");
  });
  it("처음부터 갖춰진 지점은 자르지 않는다(null) · 판정할 달이 없으면 null · 학생이 적은 달은 판정하지 않는다", () => {
    const fine = scenario({ "2026-04": [50, 0], "2026-05": [80, 0] });
    expect(trustedFrom(fine.bills, fine.firstStart, "2026-04", "2026-10", "2023-11")).toBeNull();
    const tiny = scenario({ "2026-01": [10, 5], "2026-02": [100, 1] });
    expect(trustedFrom(tiny.bills, tiny.firstStart, "2026-01", "2026-10", "2023-11")).toBeNull(); // 1월(10명)은 판정 안 함 → 2월이 첫 판정 · 이미 갖춰짐
    const none = scenario({ "2026-01": [100, 50] });
    expect(trustedFrom(none.bills, none.firstStart, "2026-01", "2026-01", "2023-11")).toBeNull();
  });
  it("청구가 창보다 먼저 시작돼 처음을 볼 수 없으면 창의 첫 달부터(보수적으로)", () => {
    const old = scenario({ "2023-11": [100, 0], "2023-12": [100, 0] });
    expect(trustedFrom(old.bills, old.firstStart, "2023-11", "2026-10", "2023-11")).toBe("2023-11");
  });
});

describe("startedRegistration — 수업을 시작한 등록만(원장 2026-10-20)", () => {
  const ev = (o: { bills?: string[]; att?: string[]; starts?: string[]; spans?: { start: string; end: string | null }[] }) => ({
    billMonths: new Map([["s", o.bills ?? []]]),
    attendedOn: new Map([["s", o.att ?? []]]),
    classSpans: new Map([["s", o.spans ?? (o.starts ?? []).map((start) => ({ start, end: null }))]]),
  });
  const reg = { id: "s", enrolledAt: "2026-03-17" };
  it("등록한 달 이후 청구 · 등록 뒤 출석 · 시작한 지 7일 지난 반 수강 중 하나면 시작한 것", () => {
    expect(startedRegistration(reg, ev({ bills: ["2026-03"] }), "2026-10-20")).toBe(true);
    expect(startedRegistration(reg, ev({ att: ["2026-03-20"] }), "2026-10-20")).toBe(true);
    expect(startedRegistration(reg, ev({ starts: ["2026-03-18"] }), "2026-10-20")).toBe(true); // 청구·출석 없이 반에서 몇 주 다닌 학생
    expect(startedRegistration(reg, ev({}), "2026-10-20")).toBe(false); // 상담만 하고 자료로 등록
  });
  it("등록 전 출석·등록 전에 시작한 반·시작한 지 7일이 안 된 반은 근거가 아니다", () => {
    expect(startedRegistration(reg, ev({ att: ["2026-03-01"] }), "2026-10-20")).toBe(false);
    expect(startedRegistration(reg, ev({ starts: ["2026-03-01"] }), "2026-10-20")).toBe(false);
    expect(startedRegistration({ id: "s", enrolledAt: "2026-10-15" }, ev({ starts: ["2026-10-16"] }), "2026-10-20")).toBe(false);
  });
  it("🔴 시작 전에 취소된 수강·며칠 만에 끝난 수강은 근거가 아니다 — 실제로 일주일 넘게 다닌 수강만(적대 재리뷰 2026-10-20)", () => {
    const oct = { id: "s", enrolledAt: "2026-10-01" };
    expect(startedRegistration(oct, ev({ spans: [{ start: "2026-10-06", end: "2026-10-06" }] }), "2026-10-20")).toBe(false); // 10/3 퇴원 → [10/6, 10/6)
    expect(startedRegistration(oct, ev({ spans: [{ start: "2026-10-06", end: "2026-10-09" }] }), "2026-10-20")).toBe(false);
    expect(startedRegistration(oct, ev({ spans: [{ start: "2026-10-06", end: "2026-10-13" }] }), "2026-10-20")).toBe(true);
    expect(startedRegistration(oct, ev({ spans: [{ start: "2026-10-06", end: "2026-12-31" }] }), "2026-10-10")).toBe(false); // 종료가 미래면 오늘까지로
  });
  it("🔴 직전 두 달 안에 청구가 살아 있던 학생은 등록일만 고쳐진 재원생 — 새로 온 학생이 아니다 · 오래 쉬었다 돌아오면 다시 등록", () => {
    expect(startedRegistration({ id: "s", enrolledAt: "2026-06-22" }, ev({ bills: ["2026-05", "2026-06"] }), "2026-10-20")).toBe(false);
    expect(startedRegistration({ id: "s", enrolledAt: "2026-06-22" }, ev({ bills: ["2026-01", "2026-06"] }), "2026-10-20")).toBe(true);
  });
});
