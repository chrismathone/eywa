import { describe, expect, it } from "vitest";
import { exitHomeroomIds, reportWriterOn, slotHomeroom, type HomeroomClass, type HomeroomRow, type HomeroomSlot } from "./exit-homeroom";

const classes: Record<string, HomeroomClass> = {
  bs: { name: "중등M 중2 BS3B", regular: true, closedAt: null },
  jj: { name: "중등M 개별 JJ3J", regular: true, closedAt: null },
  top: { name: "중등E_중1 TOP", regular: true, closedAt: null },
  sp: { name: "주말내신특강", regular: false, closedAt: null },
  old: { name: "중등M 중2 BS3A", regular: true, closedAt: null },
};
const owners: Record<string, string> = { bs: "kimyh", jj: "yoo", top: "green", sp: "lee", old: "park" };
// 영어 TOP: 9월 = 정은지 3칸 · 원어민 4칸(원어민은 담임 후보가 아니다) · 10월 = 김그린.
const slots: Record<string, HomeroomSlot[]> = {
  top: [
    ...Array.from({ length: 3 }, () => ({ teacherId: "jung", validFrom: "2026-09-01", validTo: "2026-09-30" })),
    ...Array.from({ length: 4 }, () => ({ teacherId: "native", validFrom: "2026-09-01", validTo: "2026-09-30" })),
    ...Array.from({ length: 3 }, () => ({ teacherId: "green", validFrom: "2026-10-01", validTo: null })),
  ],
};
const run = (rows: HomeroomRow[], date: string) =>
  exitHomeroomIds({
    rows, date, lookbackDays: 120,
    classOf: (id) => classes[id],
    slotsOf: (id) => slots[id] ?? [],
    owner: (id) => owners[id] ?? null,
    isKorean: (id) => id !== "native",
  });
const row = (classId: string, startDate: string, endDate: string, transferred = false): HomeroomRow => ({ classId, startDate, endDate, transferred });

describe("퇴원 담당 = 그만둘 때 다니던 반의 그날 담임(퇴원생 관리 차트 기준)", () => {
  it("🔴 수학 BS반 + JJ반을 같이 그만두면 BS반 담임만 — JJ 담임은 붙지 않는다", () => {
    expect(run([row("bs", "2026-03-01", "2026-10-01"), row("jj", "2026-03-01", "2026-10-01")], "2026-10-01")).toEqual(["kimyh"]);
  });
  it("JJ반만 다니다 그만두면 그 JJ반 담임", () => {
    expect(run([row("jj", "2026-03-01", "2026-10-01")], "2026-10-01")).toEqual(["yoo"]);
  });
  it("🔴 영어는 그날 칸에서 가장 많이 들어가는 한국인 — 지난달 선생님이 아니라 그 달 선생님 · 원어민 제외", () => {
    expect(run([row("top", "2026-03-01", "2026-10-28")], "2026-10-28")).toEqual(["green"]);
    expect(run([row("top", "2026-03-01", "2026-09-04")], "2026-09-04")).toEqual(["jung"]);
  });
  it("종료일이 1일이면 마지막으로 다닌 전날(전달) 선생님", () => {
    expect(run([row("top", "2026-03-01", "2026-10-01")], "2026-10-01")).toEqual(["jung"]);
  });
  it("특강 반 · 반 이동으로 닫힌 반은 담당이 아니다", () => {
    expect(run([row("sp", "2026-09-01", "2026-10-10"), row("bs", "2026-03-01", "2026-10-10")], "2026-10-10")).toEqual(["kimyh"]);
    expect(run([row("old", "2026-03-01", "2026-10-03", true), row("bs", "2026-10-03", "2026-10-10")], "2026-10-10")).toEqual(["kimyh"]);
  });
  it("함께 끝난 수강이 없으면 빈 배열(담당 미반영)", () => {
    expect(run([row("bs", "2026-01-01", "2026-02-01")], "2026-10-10")).toEqual([]);
  });
});

describe("slotHomeroom", () => {
  it("동률이면 null(담임 이력으로 넘긴다) · 선생님 없는 칸은 안 센다", () => {
    const s = [
      { teacherId: "a", validFrom: null, validTo: null },
      { teacherId: "b", validFrom: null, validTo: null },
      { teacherId: null, validFrom: null, validTo: null },
    ];
    expect(slotHomeroom(s, "2026-10-01", () => true)).toBeNull();
    expect(slotHomeroom([], "2026-10-01", () => true)).toBeNull();
  });
});

describe("reportWriterOn — 담임 이력이 빈 반만", () => {
  it("앞 30일 동안 가장 많이 쓴 선생님 · 동률·없음은 null", () => {
    const r = [
      { teacherId: "kim", date: "2026-06-20" }, { teacherId: "kim", date: "2026-06-25" },
      { teacherId: "lee", date: "2026-07-03" }, { teacherId: "lee", date: "2026-05-01" },
    ];
    expect(reportWriterOn(r, "2026-07-07")).toBe("kim");
    expect(reportWriterOn([{ teacherId: "a", date: "2026-07-01" }, { teacherId: "b", date: "2026-07-02" }], "2026-07-07")).toBeNull();
    expect(reportWriterOn([], "2026-07-07")).toBeNull();
  });
  it("🔴 담임 이력이 있으면 이력이 이긴다 — 보고서는 이력이 비었을 때만", () => {
    const out = exitHomeroomIds({
      rows: [{ classId: "bs", startDate: "2026-03-01", endDate: "2026-07-08", transferred: false }],
      date: "2026-07-08", lookbackDays: 120,
      classOf: () => ({ name: "중등M 중2 PS2S", regular: true, closedAt: null }),
      slotsOf: () => [],
      owner: () => null,
      isKorean: () => true,
      reportsOf: () => [{ teacherId: "hwa", date: "2026-06-30" }],
    });
    expect(out).toEqual(["hwa"]);
    expect(exitHomeroomIds({
      rows: [{ classId: "bs", startDate: "2026-03-01", endDate: "2026-07-08", transferred: false }],
      date: "2026-07-08", lookbackDays: 120,
      classOf: () => ({ name: "중등M 중2 PS2S", regular: true, closedAt: null }),
      slotsOf: () => [], owner: () => "lee", isKorean: () => true,
      reportsOf: () => [{ teacherId: "hwa", date: "2026-06-30" }],
    })).toEqual(["lee"]);
  });
});
