import { describe, expect, it } from "vitest";
import { examBarParts } from "./exam-bar";

const x = (d: string) => Number(d); // 테스트에선 날짜 대신 % 숫자 문자열

describe("examBarParts", () => {
  it("진도·밀림·앞으로 세 구간에서 자른다", () => {
    const parts = examBarParts([{ from: "10", to: "40" }], x, 20, 30);
    expect(parts.map((p) => [p.kind, p.left, p.width])).toEqual([["filled", 10, 10], ["late", 20, 10], ["open", 30, 10]]);
  });
  it("밀림이 없으면 진도 뒤는 바로 앞으로", () => {
    expect(examBarParts([{ from: "10", to: "40" }], x, 20, null).map((p) => p.kind)).toEqual(["filled", "open"]);
  });
  it("진도를 모르면 전부 앞으로 · 좁은 칸은 글자 줄임", () => {
    const parts = examBarParts([{ from: "50", to: "53" }, { from: "60", to: "61" }], x, null, null);
    expect(parts.map((p) => [p.kind, p.label])).toEqual([["open", "내신"], ["open", ""]]);
  });
});
