// 같은 내용으로 두 번째 버튼을 눌러도 새 교재 요청을 만들지 않는다 — 최연재 건(2026-10-20).
import { describe, expect, it } from "vitest";
import { requestFingerprint, sameSavedRequest } from "./_saved-request";

const base = {
  studentIds: ["s1", "s2"],
  teacherName: "셀린T",
  requestDate: "2026-10-20",
  bookName: "초6-1 발전 1권 (22개정)",
  bookDetail: "",
  price: 22500,
  notes: "",
};

describe("교재 요청 폼 — 방금 기록한 요청 다시 쓰기", () => {
  it("보이는 값이 같으면 같은 요청(학생 순서 · 앞뒤 공백 · 금액 글자/숫자 무관)", () => {
    const a = requestFingerprint(base);
    expect(requestFingerprint({ ...base, studentIds: ["s2", "s1"], bookName: " 초6-1 발전 1권 (22개정) ", price: "22500" })).toBe(a);
  });
  it("칸 하나라도 다르면 새 요청 — 같은 학생에게 다른 교재를 이어서 요청하는 흐름은 그대로", () => {
    const a = requestFingerprint(base);
    for (const diff of [{ bookName: "초6-1 발전 2권 (22개정)" }, { studentIds: ["s1"] }, { price: 23500 }, { notes: "급해요" }, { requestDate: "2026-10-21" }])
      expect(requestFingerprint({ ...base, ...diff })).not.toBe(a);
  });
  it("기록한 요청이 없거나 지문이 다르면 null", () => {
    const fp = requestFingerprint(base);
    const saved = { fp, created: [{ id: "o1", studentName: "최연재" }] };
    expect(sameSavedRequest(saved, fp)).toBe(saved);
    expect(sameSavedRequest(saved, "other")).toBeNull();
    expect(sameSavedRequest(null, fp)).toBeNull();
    expect(sameSavedRequest({ fp, created: [] }, fp)).toBeNull();
  });
});
