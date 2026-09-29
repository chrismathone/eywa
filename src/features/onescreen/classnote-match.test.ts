import { describe, expect, it } from "vitest";
import { buildCnMatchMap, cnLabelFor, cnTipCard, CN_UNAVAILABLE, pickCnForClasses } from "./classnote-match";

const boards = [{ class_id: "c1", board_name: "중등M 중1 MS2R" }];
const row = (over: Partial<Parameters<typeof buildCnMatchMap>[0][number]> = {}) => ({
  class_id: "c1",
  student_id: "s1",
  status: "ok" as const,
  child_name: "김지호",
  reason: null,
  ...over,
});

describe("buildCnMatchMap", () => {
  it("확인된 배정 = ok, 보드 이름이 붙는다", () => {
    const m = buildCnMatchMap([row()], boards, ["c1"]);
    expect(m.byKey["c1|s1"]).toEqual({ status: "ok", boardName: "중등M 중1 MS2R", childNames: ["김지호"], reasons: [] });
  });
  it("🔴 두 계정 중 하나라도 보류면 보류(한쪽만 받는 상태를 초록으로 보이지 않게)", () => {
    const m = buildCnMatchMap([row(), row({ status: "hold", child_name: "지호", reason: "반 보드 배정 전" })], boards, ["c1"]);
    expect(m.byKey["c1|s1"]!.status).toBe("hold");
    expect(m.byKey["c1|s1"]!.childNames).toEqual(["김지호", "지호"]);
    expect(m.byKey["c1|s1"]!.reasons).toEqual(["반 보드 배정 전"]);
  });
});

describe("cnLabelFor", () => {
  const map = buildCnMatchMap([row(), row({ student_id: "s2", status: "hold", child_name: null, reason: "보호자 전화 불일치" })], boards, ["c1", "c9"]);
  it("수학 반 행만 — 영어·보강(classId 없음)은 라벨 없음", () => {
    expect(cnLabelFor(map, { classId: "c1", subjectKey: "english", studentId: "s1" })).toBeNull();
    expect(cnLabelFor(map, { classId: null, subjectKey: "math", studentId: "s1" })).toBeNull();
    expect(cnLabelFor(map, { classId: "c1", subjectKey: "subject_1", studentId: "s1" })?.ok).toBe(true);
  });
  it("보류·기록 없음 = 빨강", () => {
    expect(cnLabelFor(map, { classId: "c1", subjectKey: "math", studentId: "s2" })?.ok).toBe(false);
    expect(cnLabelFor(map, { classId: "c9", subjectKey: "math", studentId: "s1" })).toEqual({ ok: false, match: null });
  });
  it("🔴 반 보드 대상이 아닌 반(특강·종강)은 라벨 없음 — 가짜 빨간불 금지", () => {
    expect(cnLabelFor(map, { classId: "c7", subjectKey: "math", studentId: "s1" })).toBeNull();
  });
  it("🔴 표를 못 읽었으면 라벨 자체를 안 그린다(거짓 빨간불 금지)", () => {
    expect(cnLabelFor(CN_UNAVAILABLE, { classId: "c1", subjectKey: "math", studentId: "s1" })).toBeNull();
    expect(cnLabelFor(undefined, { classId: "c1", subjectKey: "math", studentId: "s1" })).toBeNull();
  });
});

describe("pickCnForClasses", () => {
  it("강사 로스터의 반만 남긴다(다른 반 학생의 보류 사유를 내려보내지 않음)", () => {
    const m = buildCnMatchMap([row(), row({ class_id: "c2", student_id: "s9", status: "hold", reason: "x" })], boards, ["c1", "c2"]);
    expect(Object.keys(pickCnForClasses(m, ["c1"]).byKey)).toEqual(["c1|s1"]);
    expect(pickCnForClasses(m, ["c1"]).eligibleClassIds).toEqual(["c1"]);
    expect(pickCnForClasses(CN_UNAVAILABLE, ["c1"]).available).toBe(false);
  });
});

describe("cnTipCard", () => {
  it("기록이 없으면 안내 문장, 있으면 사유를 싣는다", () => {
    expect(cnTipCard({ ok: false, match: null }, "A반").lines[0]).toContain("연결 기록이 없습니다");
    const tip = cnTipCard({ ok: false, match: { status: "hold", boardName: "A반", childNames: [], reasons: ["보호자 전화 불일치"] } }, "A반");
    expect(tip.meta).toBe("매칭 실패");
    expect(tip.lines).toEqual(["보호자 전화 불일치"]);
  });
});
