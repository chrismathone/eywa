import { describe, expect, it } from "vitest";
import { bucketIntake } from "./intake-trend";
import { parseStatsPeriod } from "@/features/stats/period";
import { sliceGroupsOf } from "@/features/dashboard/layout/slices";

const subjects = [
  { key: "math", label: "수학" },
  { key: "english", label: "영어" },
];
const groupsOf = sliceGroupsOf(subjects, (k) => (k === "math" || k === "english" ? k : null));
const TODAY = "2026-10-20";

describe("bucketIntake — 신규 문의 추이", () => {
  it("일별 — 칸마다 세고 · 자유 입력 과목은 운영실과 같은 판정(EIE = 영어 · '영어 수학' = 둘 다) · 못 읽는 칸은 모름 · 기간 밖은 뺀다", () => {
    const period = parseStatsPeriod({ grain: "day", month: "2026-10" }, TODAY);
    const t = bucketIntake(
      [
        { date: "2026-10-01", subject: "EIE" },
        { date: "2026-10-01", subject: "영어 수학" },
        { date: "2026-10-02", subject: null },
        { date: "2026-10-02", subject: "국어" },
        { date: "2026-10-20", subject: "math" },
        { date: "2026-09-30", subject: "수학" }, // 기간 밖
        { date: "2026-10-21", subject: "수학" }, // 미래(기간 밖)
      ],
      period,
      groupsOf,
    );
    expect(t.keys).toHaveLength(20);
    expect([t.total[0], t.total[1], t.total[19]]).toEqual([2, 2, 1]);
    expect(t.groups.map((g) => [g.group, g.values[0], g.values[19]])).toEqual([
      ["english", 2, 0],
      ["math", 1, 1],
    ]);
    expect(t.unknown[1]).toBe(2);
  });

  it("월별 — 달로 묶는다 · 빈 달은 0", () => {
    const t = bucketIntake([{ date: "2026-09-03", subject: "수학" }, { date: "2026-09-30", subject: "영어" }], parseStatsPeriod({}, TODAY), groupsOf);
    expect(t.keys.at(-2)).toBe("2026-09");
    expect([t.total.at(-2), t.total.at(-1), t.total[0]]).toEqual([2, 0, 0]);
  });
});

import { intakeGroupMeta } from "./intake-groups";

describe("intakeGroupMeta — 과목 선 이름·색(학원 설정)", () => {
  it("수학(심화)는 수학 선에 묶이고 이름은 '수학' · 그 밖 과목은 제 이름", () => {
    const meta = intakeGroupMeta([
      { key: "subject_1", label: "수학(심화)", color: "purple" },
      { key: "math", label: "수학", color: "blue" },
      { key: "english", label: "영어", color: "rose" },
      { key: "korean", label: "국어", color: "green" },
    ] as never);
    expect(Object.keys(meta).sort()).toEqual(["english", "korean", "math"]);
    expect([meta.math!.label, meta.english!.label, meta.korean!.label]).toEqual(["수학", "영어", "국어"]);
    // 색도 학원 설정(수학 = math 과목의 파랑 · 심화의 보라가 아니다).
    expect([meta.math!.color, meta.korean!.color]).toEqual(["var(--color-blue)", "var(--color-green)"]);
  });
});
