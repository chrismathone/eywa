import { describe, expect, it } from "vitest";
import {
  classNameForWeek,
  buildClassNameAsOfIndex,
  resolveClassNameAsOf,
  type PendingRename,
} from "./class-name-as-of";

const r = (o: Partial<PendingRename> & { classId: string; to: string; date: string }): PendingRename => ({
  from: null,
  ...o,
});

describe("resolveClassNameAsOf", () => {
  const idx = buildClassNameAsOfIndex([
    r({ classId: "c1", from: "DP6", to: "PL1a", date: "2026-09-01" }),
  ]);

  it("적용일부터 새 이름이다", () => {
    expect(resolveClassNameAsOf(idx, "c1", "2026-09-01", "DP6")).toEqual({
      name: "PL1a",
      before: "DP6",
      date: "2026-09-01",
    });
    expect(resolveClassNameAsOf(idx, "c1", "2026-09-07", "DP6")?.name).toBe("PL1a");
  });

  it("적용일 전날까지는 옛 이름이다(null = 현재 이름 그대로)", () => {
    expect(resolveClassNameAsOf(idx, "c1", "2026-08-31", "DP6")).toBeNull();
  });

  it("예약이 없는 반은 건드리지 않는다", () => {
    expect(resolveClassNameAsOf(idx, "다른반", "2026-09-01", "MS2A")).toBeNull();
  });

  it("🔴 사람이 그 사이 이름을 바꿨으면 아무 말도 하지 않는다", () => {
    // cron의 shouldApplyName이 건너뛰는 경우 — 화면이 오지 않을 미래를 약속하면 안 된다.
    expect(resolveClassNameAsOf(idx, "c1", "2026-09-01", "DP6-수정됨")).toBeNull();
  });

  it("사슬을 따라간다(9/1 DP6→PL1a · 10/1 PL1a→PL2)", () => {
    const chain = buildClassNameAsOfIndex([
      r({ classId: "c1", from: "PL1a", to: "PL2", date: "2026-10-01" }),
      r({ classId: "c1", from: "DP6", to: "PL1a", date: "2026-09-01" }),
    ]);
    expect(resolveClassNameAsOf(chain, "c1", "2026-09-15", "DP6")?.name).toBe("PL1a");
    expect(resolveClassNameAsOf(chain, "c1", "2026-10-05", "DP6")).toEqual({
      name: "PL2",
      before: "DP6",
      date: "2026-10-01",
    });
  });

  it("사슬 중간이 어긋나면 거기서 멈춘다", () => {
    // 첫 고리가 안 맞으면 그 뒤도 못 간다 — cron도 같은 자리에서 멈춘다.
    const chain = buildClassNameAsOfIndex([
      r({ classId: "c1", from: "DP6", to: "PL1a", date: "2026-09-01" }),
      r({ classId: "c1", from: "손댄이름", to: "PL2", date: "2026-10-01" }),
    ]);
    expect(resolveClassNameAsOf(chain, "c1", "2026-10-05", "DP6")?.name).toBe("PL1a");
  });

  it("사다리 회전은 반끼리 안 부딪힌다(LS6→LE1 · LS5→LS6)", () => {
    // 같은 이름이 오갈 뿐 classId가 달라 각자 자기 사슬만 걷는다.
    const ladder = buildClassNameAsOfIndex([
      r({ classId: "A", from: "LS6", to: "LE1", date: "2026-09-01" }),
      r({ classId: "B", from: "LS5", to: "LS6", date: "2026-09-01" }),
    ]);
    expect(resolveClassNameAsOf(ladder, "A", "2026-09-01", "LS6")?.name).toBe("LE1");
    expect(resolveClassNameAsOf(ladder, "B", "2026-09-01", "LS5")?.name).toBe("LS6");
  });

  it("이름 없는 반(조인 미스)은 판정하지 않는다", () => {
    expect(resolveClassNameAsOf(idx, "c1", "2026-09-01", null)).toBeNull();
  });

  it("to가 비면 색인에 넣지 않는다", () => {
    expect(buildClassNameAsOfIndex([r({ classId: "c1", to: "", date: "2026-09-01" })]).size).toBe(0);
  });
});

describe("classNameForWeek — 주 단위 표면(ECS)", () => {
  const idx = buildClassNameAsOfIndex([
    r({ classId: "c1", from: "DP6", to: "PL1a", date: "2026-09-01" }),
  ]);

  it("개명 전 주는 아무 말도 하지 않는다(null = DB 이름 그대로)", () => {
    expect(classNameForWeek(idx, "c1", "2026-08-24", "2026-08-30", "DP6")).toBeNull();
  });

  it("🔴 전환 주는 **옛 이름으로 부르고** 그 주 안에 온다고 예고한다", () => {
    // 9/1(화)에 바뀐다 = 월요일엔 아직 DP6다. 새 이름으로 먼저 부르면 하루 앞서 간다.
    expect(classNameForWeek(idx, "c1", "2026-08-31", "2026-09-06", "DP6")).toEqual({
      name: "DP6",
      upcoming: { name: "PL1a", date: "2026-09-01" },
    });
  });

  it("그 다음 주부터는 새 이름이고 예고는 없다", () => {
    expect(classNameForWeek(idx, "c1", "2026-09-07", "2026-09-13", "DP6")).toEqual({
      name: "PL1a",
      before: "DP6",
    });
  });

  it("주 시작일에 딱 맞으면 그 주부터 새 이름이다", () => {
    const mon = buildClassNameAsOfIndex([r({ classId: "c1", from: "A", to: "B", date: "2026-09-07" })]);
    expect(classNameForWeek(mon, "c1", "2026-09-07", "2026-09-13", "A")).toEqual({ name: "B", before: "A" });
  });

  it("사람이 손댔으면 예고도 하지 않는다", () => {
    expect(classNameForWeek(idx, "c1", "2026-08-31", "2026-09-06", "손댄이름")).toBeNull();
  });

  it("이름 없는 반은 판정하지 않는다", () => {
    expect(classNameForWeek(idx, "c1", "2026-08-31", "2026-09-06", null)).toBeNull();
  });
});
