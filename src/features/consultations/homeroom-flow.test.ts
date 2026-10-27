import { describe, expect, it } from "vitest";
import { buildPrevMonthFlow, type FlowInput } from "./homeroom-flow";

const st = (name: string, withdrawnAt: string | null = null) => ({ name, withdrawn: withdrawnAt !== null, withdrawnAt });
const base = (over: Partial<FlowInput> = {}): FlowInput => ({
  prevMonth: "2026-09",
  classes: new Map([
    ["bs2g", { teacherId: "new", subject: "math" }],
    ["eng", { teacherId: "eng-t", subject: "english" }],
    ["bs1k", { teacherId: "new", subject: "math" }],
  ]),
  // BS2G: 8/3부터 old, 9/1부터 new(인수인계 감사로그).
  homeroomHistory: new Map([
    [
      "bs2g",
      [
        { teacherId: "old", from: "2026-08-03", to: "2026-09-01" },
        { teacherId: "new", from: "2026-09-01", to: null },
      ],
    ],
  ]),
  enrollments: [],
  students: new Map(),
  ...over,
});
const e = (studentId: string, classId: string, startDate: string | null, endDate: string | null, extra: { isTransferred?: boolean; live?: boolean } = {}) => ({
  studentId,
  classId,
  startDate,
  endDate,
  isTransferred: extra.isTransferred ?? false,
  live: extra.live ?? endDate === null,
});

describe("buildPrevMonthFlow", () => {
  it("퇴원일이 수강 종료일보다 앞서면 퇴원일로 — 8/31 퇴원은 9월 퇴원이 아니고 새 담임 몫도 아니다(윤채민)", () => {
    const out = buildPrevMonthFlow(base({ enrollments: [e("yun", "bs2g", "2026-05-06", "2026-09-01")], students: new Map([["yun", st("윤채민", "2026-08-31")]]) }));
    expect(out.get("new")?.withdrawn ?? []).toEqual([]);
    expect(out.get("old")?.withdrawn ?? []).toEqual([]);
  });

  it("9월 중 퇴원은 그날의 담임 몫 · 9월 말 학생 수도 그 당시 담임", () => {
    const out = buildPrevMonthFlow(
      base({
        enrollments: [e("a", "bs2g", "2026-03-01", "2026-09-20"), e("b", "bs2g", "2026-03-01", null)],
        students: new Map([
          ["a", st("가퇴원", "2026-09-20")],
          ["b", st("나재원")],
        ]),
      }),
    );
    expect(out.get("new")).toEqual({ students: 1, withdrawn: [{ id: "a", name: "가퇴원" }], ended: [] });
  });

  it("수강 종료 = 학원은 다니지만 그 과목 수강이 오늘 없음 · 같은 과목 다른 반에 있으면(반이동) 안 셈", () => {
    const out = buildPrevMonthFlow(
      base({
        enrollments: [
          e("drop", "bs2g", "2026-03-01", "2026-09-10"),
          e("drop", "eng", "2026-03-01", null),
          e("move", "bs2g", "2026-03-01", "2026-09-10"),
          e("move", "bs1k", "2026-09-10", null),
          e("tr", "bs2g", "2026-03-01", "2026-09-10", { isTransferred: true }),
        ],
        students: new Map([
          ["drop", st("영어만")],
          ["move", st("반옮김")],
          ["tr", st("반이동")],
        ]),
      }),
    );
    expect(out.get("new")?.ended).toEqual([{ id: "drop", name: "영어만" }]);
    expect(out.get("new")?.withdrawn).toEqual([]);
  });

  it("8월 말 이전 담임 기간의 학생 수는 9월 말 기준이라 새 담임으로 센다", () => {
    const out = buildPrevMonthFlow(base({ enrollments: [e("b", "bs2g", "2026-03-01", null)], students: new Map([["b", st("나재원")]]) }));
    expect(out.get("new")?.students).toBe(1);
    expect(out.get("old")).toBeUndefined();
  });
});
