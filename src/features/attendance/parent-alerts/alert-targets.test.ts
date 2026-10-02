import { describe, expect, it } from "vitest";
import { crossTeacherIds, mergeAlertTargets } from "./alert-targets";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

describe("crossTeacherIds — 저장된 다른 과목 담당 목록 읽기", () => {
  it("계정 id 배열만 받는다 · 중복은 한 번", () => {
    expect(crossTeacherIds([A, B, A])).toEqual([A, B]);
  });
  it("배열이 아니거나 모양이 다른 원소는 버린다(칸이 없는 DB의 undefined 포함)", () => {
    expect(crossTeacherIds(undefined)).toEqual([]);
    expect(crossTeacherIds(null)).toEqual([]);
    expect(crossTeacherIds("[]")).toEqual([]);
    expect(crossTeacherIds({ 0: A })).toEqual([]);
    expect(crossTeacherIds([A, 7, null, { id: B }, "아무 글자", ""])).toEqual([A]);
  });
  it("상한을 넘는 목록은 앞에서부터 자른다", () => {
    const many = Array.from({ length: 30 }, (_, i) => `${String(i).padStart(8, "0")}-1111-4111-8111-111111111111`);
    expect(crossTeacherIds(many)).toHaveLength(10);
  });
});

describe("mergeAlertTargets — 받는 사람 합치기", () => {
  it("토글 켠 계정 먼저, 같은 사람은 한 줄", () => {
    expect(mergeAlertTargets([A], [B, A])).toEqual([A, B]);
    expect(mergeAlertTargets([], [B])).toEqual([B]);
    expect(mergeAlertTargets([A], [])).toEqual([A]);
  });
});
