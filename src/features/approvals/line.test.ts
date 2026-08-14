import { describe, it, expect } from "vitest";
import {
  MAX_APPROVAL_STEPS,
  MAX_REFS,
  normalizeLine,
  normalizeRefs,
  validateApprovalLine,
} from "./line";

const ME = "me";
const A = "user-a";
const B = "user-b";
const C = "user-c";
const POOL = [A, B, C];

describe("결재선 정규화", () => {
  it("중복 제거 + 순서 보존 + 기안자 제거", () => {
    expect(normalizeLine(ME, [A, B, A, ME, C])).toEqual([A, B, C]);
    expect(normalizeLine(ME, [])).toEqual([]);
    expect(normalizeLine(ME, ["", ME])).toEqual([]);
  });

  it("참조자는 결재선에 이미 있는 사람을 뺀다(결재자는 어차피 본다)", () => {
    expect(normalizeRefs(ME, [A], [A, B, ME, B])).toEqual([B]);
  });
});

describe("결재선 검증", () => {
  it("정상 결재선은 통과", () => {
    expect(validateApprovalLine({ drafterId: ME, approverIds: [A, B], candidateIds: POOL })).toBeNull();
    expect(
      validateApprovalLine({ drafterId: ME, approverIds: [A], refIds: [B], candidateIds: POOL }),
    ).toBeNull();
  });

  it("결재자 0명은 거절", () => {
    expect(validateApprovalLine({ drafterId: ME, approverIds: [], candidateIds: POOL })).toContain(
      "1명 이상",
    );
    // 기안자만 넣어도 정규화 후 0명이다.
    expect(validateApprovalLine({ drafterId: ME, approverIds: [ME], candidateIds: POOL })).toContain(
      "1명 이상",
    );
  });

  it("본인이 결재선에 섞이면 거절", () => {
    expect(validateApprovalLine({ drafterId: ME, approverIds: [A, ME], candidateIds: POOL })).toBe(
      "본인은 결재선에 넣을 수 없습니다",
    );
  });

  it("후보 풀 밖 결재자·참조자는 거절", () => {
    expect(
      validateApprovalLine({ drafterId: ME, approverIds: ["outsider"], candidateIds: POOL }),
    ).toContain("결재자로 지정할 수 없는");
    expect(
      validateApprovalLine({ drafterId: ME, approverIds: [A], refIds: ["outsider"], candidateIds: POOL }),
    ).toContain("참조로 지정할 수 없는");
  });

  it("단계·참조 상한", () => {
    const many = Array.from({ length: MAX_APPROVAL_STEPS + 1 }, (_, i) => `u${i}`);
    expect(
      validateApprovalLine({ drafterId: ME, approverIds: many, candidateIds: many }),
    ).toContain(`최대 ${MAX_APPROVAL_STEPS}단계`);

    const refs = Array.from({ length: MAX_REFS + 1 }, (_, i) => `r${i}`);
    expect(
      validateApprovalLine({ drafterId: ME, approverIds: [A], refIds: refs, candidateIds: [A, ...refs] }),
    ).toContain(`최대 ${MAX_REFS}명`);
  });
});
