import { describe, expect, it } from "vitest";
import { periodWindowLabel } from "./window-label";
import type { PeriodWindow } from "./resolve";

const monthWin: PeriodWindow = {
  kind: "month",
  scope: null,
  start: "2026-03-01",
  end: "2026-03-31",
  label: "2026년 3월",
  defId: null,
};

const sessionWin: PeriodWindow = {
  kind: "session",
  scope: "class",
  start: "2026-03-06",
  end: "2026-04-02",
  label: "2026년 3월 세션 (3/6~4/2)",
  defId: "d1",
};

describe("기간 창 표기", () => {
  it("한국어는 저장된 라벨 그대로 — 한 글자도 안 바뀐다", () => {
    expect(periodWindowLabel(monthWin, "ko")).toBe(monthWin.label);
    expect(periodWindowLabel(sessionWin, "ko")).toBe(sessionWin.label);
  });

  it("영어는 같은 재료로 다시 만든다", () => {
    expect(periodWindowLabel(monthWin, "en")).toBe("March 2026");
    expect(periodWindowLabel(sessionWin, "en")).toBe("March 2026 session (Mar 6–Apr 2)");
  });

  it("🔴 라벨월은 시작월이 아니라 **한국어 라벨**에서 읽는다 — 세션은 둘이 다를 수 있다", () => {
    // 2월 세션이 3/5까지 가는 실제 사례(0189a 주석) — start(2월)와 라벨월(2월)이 같아도,
    // 라벨을 진실로 삼아야 라벨이 바뀔 때 영어가 따라온다.
    const feb: PeriodWindow = { ...sessionWin, start: "2026-02-06", end: "2026-03-05", label: "2026년 2월 세션 (2/6~3/5)" };
    expect(periodWindowLabel(feb, "en")).toBe("February 2026 session (Feb 6–Mar 5)");
  });

  it("깨진 창(재료 없음·라벨 미상)은 한국어 원문으로 떨어진다 — 지어내지 않는다", () => {
    const broken: PeriodWindow = { kind: "month", scope: null, start: "", end: "", label: "기간을 확인할 수 없습니다", defId: null };
    expect(periodWindowLabel(broken, "en")).toBe("기간을 확인할 수 없습니다");
    expect(periodWindowLabel({ ...monthWin, label: "이상한 값" }, "en")).toBe("이상한 값");
  });
});
