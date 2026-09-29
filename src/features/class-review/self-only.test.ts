import { describe, expect, it } from "vitest";
import { isOwnReview, isSelfOnlyReviewer, redactForSelfOnly } from "./self-only";
import type { ReviewDoc } from "./server/queries";

const doc: ReviewDoc = {
  id: "d1",
  createdAt: "2026-08-19T00:00:00Z",
  header: {
    date: "2026-08-19",
    teacherId: "T",
    teacherName: "김강사",
    subject: "math",
    className: "",
    session: "",
    classTime: "",
    studentCount: "",
    observerMode: "open",
    observerLimit: 5,
  },
  evaluators: [
    { id: "O1", name: "박부원장", kind: "observer" },
    { id: "T", name: "김강사", kind: "self" },
  ],
  submissions: {
    O1: { scores: [4, 3], comment: "관찰자 코멘트", submittedAt: "2026-08-19T01:00:00Z" },
    self: { scores: [3, 3], comment: "본인 코멘트", submittedAt: "2026-08-19T02:00:00Z" },
  },
};

describe("자기 평가 전용(강사 직급)", () => {
  it("판정 축은 직급 — 강사만 자기 평가 전용", () => {
    expect(isSelfOnlyReviewer("teacher")).toBe(true);
    for (const r of ["master", "admin", "manager", "counselor", "accountant", "viewer"] as const) {
      expect(isSelfOnlyReviewer(r)).toBe(false);
    }
  });

  it("본인 평가지 판별", () => {
    expect(isOwnReview(doc, "T")).toBe(true);
    expect(isOwnReview(doc, "O1")).toBe(false);
    expect(isOwnReview(doc, "")).toBe(false); // 빈 id가 빈 teacherId와 맞아떨어지지 않게
  });

  it("가림 — 본인 채점 한 장만 남고 관찰자 채점·이름이 사라진다", () => {
    const r = redactForSelfOnly(doc);
    expect(Object.keys(r.submissions)).toEqual(["self"]);
    expect(r.submissions.self?.comment).toBe("본인 코멘트");
    expect(JSON.stringify(r)).not.toContain("관찰자 코멘트");
    expect(JSON.stringify(r)).not.toContain("박부원장");
    expect(r.evaluators).toHaveLength(1);
    expect(r.evaluators[0]?.kind).toBe("self");
  });

  it("가림 — 선착순 정원이 새지 않게 assigned로 되돌린다", () => {
    const r = redactForSelfOnly(doc);
    expect(r.header.observerMode).toBe("assigned");
    expect(r.header.observerLimit).toBe(1);
    // 원본은 안 건드린다(참조 공유로 다른 소비처가 오염되면 안 된다).
    expect(doc.header.observerMode).toBe("open");
    expect(Object.keys(doc.submissions)).toHaveLength(2);
  });

  it("가림 — 사무실 최종 총평은 본인에게도 안 내려간다", () => {
    const r = redactForSelfOnly({
      ...doc,
      finalReview: { text: "최종 총평 문장", updatedAt: "2026-09-29T00:00:00Z", by: { id: "M", name: "원장" } },
    });
    expect(r.finalReview).toBeUndefined();
    expect(JSON.stringify(r)).not.toContain("최종 총평 문장");
  });

  it("본인 채점이 아직 없으면 빈 제출", () => {
    const r = redactForSelfOnly({ ...doc, submissions: { O1: doc.submissions.O1! } });
    expect(r.submissions).toEqual({});
  });
});
