import { describe, expect, it } from "vitest";
import {
  decodeLinkPick,
  encodeLinkPick,
  linkOptionsOf,
  suggestLinkItem,
  suggestSubjectRow,
  type NewcomerLinkRow,
} from "./consult-link";

const row = (over: Partial<NewcomerLinkRow> = {}): NewcomerLinkRow => ({
  subject: "math",
  enrolledOn: "2026-08-22",
  firstClassOn: "2026-09-01",
  checks: {},
  ...over,
});

describe("suggestLinkItem — 날짜 규칙으로 한 칸", () => {
  it("첫 수업 전이면 사전 콜, 첫 수업일을 몰라도 사전 콜", () => {
    expect(suggestLinkItem(row(), "2026-08-30")).toBe("pre_call");
    expect(suggestLinkItem(row({ firstClassOn: null }), "2026-08-30")).toBe("pre_call");
  });
  it("첫 수업 전인데 사전 콜이 이미 끝났으면 해당 없음", () => {
    expect(suggestLinkItem(row({ checks: { pre_call: "2026-08-29" } }), "2026-08-30")).toBe("");
  });
  it("첫 수업 후엔 기한이 가장 가까운 칸 — 사전 콜은 빼고", () => {
    expect(suggestLinkItem(row(), "2026-09-03")).toBe("after_first_call");
    expect(suggestLinkItem(row({ checks: { after_first_call: "2026-09-05" } }), "2026-09-20")).toBe("month1_call");
    expect(suggestLinkItem(row(), "2026-11-18")).toBe("month3_call");
  });
  it("기한보다 열흘 넘게 이른 칸은 제안하지 않는다", () => {
    // 1개월 콜 기한 9/21 — 9/5 상담은 16일 이르다.
    expect(suggestLinkItem(row({ checks: { after_first_call: "2026-09-04" } }), "2026-09-05")).toBe("");
  });
  it("이 상담으로 이미 한 칸이 있으면 그것", () => {
    expect(suggestLinkItem(row({ checks: { month1_call: "2026-09-20" }, linked: ["month1_call"] }), "2026-11-18")).toBe(
      "month1_call",
    );
  });
});

describe("linkOptionsOf", () => {
  it("콜 칸만, 다른 경로로 끝난 칸은 완료 표시(이 상담으로 한 칸은 고를 수 있다)", () => {
    const opts = linkOptionsOf(row({ checks: { pre_call: "2026-08-30", month1_call: "2026-09-21" }, linked: ["month1_call"] }));
    expect(opts.map((o) => o.key)).toEqual(["pre_call", "after_first_call", "month1_call", "month2_call", "month3_call"]);
    expect(opts.find((o) => o.key === "pre_call")?.doneElsewhere).toBe("2026-08-30");
    expect(opts.find((o) => o.key === "month1_call")?.doneElsewhere).toBeNull();
    expect(opts.find((o) => o.key === "after_first_call")?.due).toBe("2026-09-08");
  });
});

describe("suggestSubjectRow — 못 좁히면 걸지 않는다", () => {
  const math = row({ subject: "math" });
  const eng = row({ subject: "english" });
  it("과목이 하나면 그 줄", () => {
    expect(suggestSubjectRow([math], null, [])).toBe(math);
  });
  it("상담 과목 → 상담자 담당 과목 순", () => {
    expect(suggestSubjectRow([math, eng], "english", ["math"])).toBe(eng);
    expect(suggestSubjectRow([math, eng], null, ["math"])).toBe(math);
  });
  it("둘 다 맡은 상담자·과목 모름은 null", () => {
    expect(suggestSubjectRow([math, eng], null, ["math", "english"])).toBeNull();
    expect(suggestSubjectRow([math, eng], null, [])).toBeNull();
  });
});

describe("폼 값 인코딩", () => {
  it("왕복하고, 모르는 항목·이상한 과목은 버린다", () => {
    expect(decodeLinkPick(encodeLinkPick("math", "pre_call"))).toEqual({ subject: "math", itemKey: "pre_call" });
    expect(decodeLinkPick(encodeLinkPick(null, "month1_call"))).toEqual({ subject: "", itemKey: "month1_call" });
    expect(decodeLinkPick("math|ojt")).toBeNull();
    expect(decodeLinkPick("Math!|pre_call")).toBeNull();
    expect(decodeLinkPick("")).toBeNull();
  });
});
