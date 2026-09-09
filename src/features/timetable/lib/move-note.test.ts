import { describe, expect, it } from "vitest";

import { koreanMonthDay, moveWaitTitle, savedMoveView } from "./move-note";

describe("koreanMonthDay", () => {
  it("앞 0을 뗀 한글 날짜", () => {
    expect(koreanMonthDay("2026-09-05")).toBe("9월 5일");
  });
  it("형식이 아니면 원문", () => {
    expect(koreanMonthDay("나중에")).toBe("나중에");
    expect(koreanMonthDay(null)).toBe("");
  });
});

describe("moveWaitTitle", () => {
  const base = { fromClassName: "LT3", toClassName: "LS6", on: "2026-09-15" } as const;

  it("어느 쪽이든 기존 반 이름이 들어간다(원장 명시)", () => {
    expect(moveWaitTitle({ ...base, side: "out", saved: true })).toContain("기존 반: LT3");
    expect(moveWaitTitle({ ...base, side: "in", saved: true })).toContain("기존 반: LT3");
  });

  it("나가는 쪽·들어오는 쪽 방향이 다르게 적힌다", () => {
    expect(moveWaitTitle({ ...base, side: "out", saved: true })).toContain("LS6 반으로 이동합니다");
    expect(moveWaitTitle({ ...base, side: "in", saved: true })).toContain("LS6 반으로 옵니다");
  });

  it("저장 전은 '저장 전'이라고 말하고 저장을 재촉한다", () => {
    const q = moveWaitTitle({ ...base, side: "out", saved: false });
    expect(q).toContain("저장 전");
    expect(q).toContain("'저장'을 눌러야 반영됩니다");
    const s = moveWaitTitle({ ...base, side: "out", saved: true });
    expect(s).not.toContain("저장 전");
    expect(s).not.toContain("눌러야");
  });

  it("날짜를 모르면 날짜를 지어내지 않는다", () => {
    const t = moveWaitTitle({ ...base, on: null, side: "out", saved: true });
    expect(t).toContain("LS6 반으로 이동합니다");
    expect(t).not.toContain("undefined");
    expect(t).not.toMatch(/\d월/);
  });

  it("반 이름이 비어도 빈칸을 남기지 않는다", () => {
    const t = moveWaitTitle({ fromClassName: "", toClassName: "", on: "2026-09-15", side: "in", saved: true });
    expect(t).toContain("기존 반: 지금 반");
    expect(t).toContain("다른 반 반으로 옵니다");
  });
});

describe("savedMoveView", () => {
  const out = { on: "2026-09-20", className: "LS6" };
  const inc = { on: "2026-09-12", className: "LT3" };

  it("재원 줄은 '나감'을 말한다", () => {
    const v = savedMoveView({ status: "active", movingOut: out, thisClassName: "LT3" });
    expect(v).toMatchObject({ side: "out", on: "2026-09-20" });
    expect(v!.title).toContain("기존 반: LT3");
    expect(v!.title).toContain("LS6 반으로 이동합니다");
  });

  it("대기 줄은 '들어옴'을 말한다(둘 다 걸려 있어도)", () => {
    const v = savedMoveView({ status: "hold", movingOut: out, movingIn: inc, thisClassName: "LS6" });
    expect(v).toMatchObject({ side: "in", on: "2026-09-12" });
    expect(v!.title).toContain("기존 반: LT3");
    expect(v!.title).toContain("LS6 반으로 옵니다");
  });

  it("퇴원 줄엔 아무것도 안 붙인다", () => {
    expect(savedMoveView({ status: "withdrawn", movingOut: out, thisClassName: "LT3" })).toBeNull();
  });

  it("예약이 없으면 null", () => {
    expect(savedMoveView({ status: "active", thisClassName: "LT3" })).toBeNull();
  });

  it("상대 반을 못 찾았으면 '다른 반'으로 적고 날짜는 살린다", () => {
    const v = savedMoveView({ status: "active", movingOut: { on: "2026-09-20", className: null }, thisClassName: "LT3" });
    expect(v!.title).toContain("다른 반 반으로 이동합니다");
    expect(v!.on).toBe("2026-09-20");
  });
});
