import { describe, expect, it } from "vitest";
import { counselorAccountPatch } from "./counselor-account";

const me = "me", other = "other";

describe("counselorAccountPatch — 상담자 글자와 계정을 함께(2026-10-26 김성현 상담)", () => {
  it("빈 상담자를 처음 고친 직원으로 채우면 비어 있던 계정도 그 사람", () => {
    expect(counselorAccountPatch({ beforeAccount: null, patch: { counselor: "정유진" }, autofilled: "정유진", userId: me, resolved: null })).toBe(me);
  });
  it("자동 채움이어도 계정이 이미 있으면 그대로", () => {
    expect(counselorAccountPatch({ beforeAccount: other, patch: {}, autofilled: "정유진", userId: me, resolved: null })).toBeUndefined();
  });
  it("상담자 이름을 고치면 이름이 딱 한 명과 같을 때만 그 계정", () => {
    expect(counselorAccountPatch({ beforeAccount: me, patch: { counselor: "설현" }, autofilled: null, userId: me, resolved: other })).toBe(other);
    expect(counselorAccountPatch({ beforeAccount: me, patch: { counselor: "모르는 이름" }, autofilled: null, userId: me, resolved: null })).toBeUndefined();
    expect(counselorAccountPatch({ beforeAccount: other, patch: { counselor: "설현" }, autofilled: null, userId: me, resolved: other })).toBeUndefined();
  });
  it("계정을 직접 고른 저장은 손대지 않는다 · 상담자 칸을 안 건드리면 손대지 않는다", () => {
    expect(counselorAccountPatch({ beforeAccount: null, patch: { consultant_id: other, counselor: "정유진" }, autofilled: "정유진", userId: me, resolved: me })).toBeUndefined();
    expect(counselorAccountPatch({ beforeAccount: null, patch: { prospect_name: "김성현" }, autofilled: null, userId: me, resolved: null })).toBeUndefined();
  });
});
