import { describe, it, expect } from "vitest";
import { isPushableConsultation, pushEligibilityNote } from "./push-eligibility";

describe("isPushableConsultation", () => {
  it("enrolled가 아니면 원래대로 보낼 수 있다", () => {
    for (const outcome of ["pending", "scheduled", "consulted", "ai_done", "declined", "no_show"]) {
      expect(isPushableConsultation({ outcome, studentMakeeduId: null })).toBe(true);
      expect(isPushableConsultation({ outcome, studentMakeeduId: "14101" })).toBe(true);
    }
  });

  // 원래 의도 보존 — 허다언(14101)·권한결(14067)·김유하(14106) 케이스.
  it("enrolled + 학생이 makeedu 원생이면 제외 (이미 다니는 학생이 신규 문의로 뜨는 군더더기)", () => {
    expect(isPushableConsultation({ outcome: "enrolled", studentMakeeduId: "14101" })).toBe(false);
  });

  // 구멍 — 권도현 케이스(QR 접수→같은 날 등록·배정, makeedu 어디에도 없음).
  it("enrolled + 학생이 makeedu에 없으면 보낼 수 있다", () => {
    expect(isPushableConsultation({ outcome: "enrolled", studentMakeeduId: null })).toBe(true);
    expect(isPushableConsultation({ outcome: "enrolled", studentMakeeduId: undefined })).toBe(true);
    expect(isPushableConsultation({ outcome: "enrolled", studentMakeeduId: "" })).toBe(true);
  });
});

describe("pushEligibilityNote", () => {
  it("구멍 케이스에만 사유를 밝힌다", () => {
    expect(pushEligibilityNote({ outcome: "enrolled", studentMakeeduId: null })).toContain("원생으로 전환");
  });

  it("평범한 후보엔 노트 없음", () => {
    expect(pushEligibilityNote({ outcome: "pending", studentMakeeduId: null })).toBeNull();
    expect(pushEligibilityNote({ outcome: "consulted", studentMakeeduId: "14101" })).toBeNull();
    expect(pushEligibilityNote({ outcome: "enrolled", studentMakeeduId: "14101" })).toBeNull();
  });
});
