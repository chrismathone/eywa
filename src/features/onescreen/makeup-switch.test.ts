import { describe, expect, it } from "vitest";
import { joinMakeupContent, joinText, planJoinMakeup, planSplitMakeup } from "./makeup-switch";
import type { Subject } from "./types";

const row = (over: Partial<Subject>): Subject => ({ name: "수학", subjectKey: "math", prev: "", today: "", textbook: "", homeworkToday: "", ...over }) as Subject;
const notSent = () => false;

// 하루 정규 수업 둘(BS2G 16:20 · JJ2G 18:20) — 선생님 한 분, 같은 과목.
const regularA = row({ name: "수학 · BS2G", classId: "BS2G", makeup: false, attendanceRaw: "present" });
const regularB = row({ name: "수학 · JJ2G", classId: "JJ2G", makeup: false, attendanceRaw: null });
const makeupOnA = row({ name: "수학 (보강)", classId: null, makeup: true, makeupClassId: "BS2G" });

describe("planJoinMakeup — 분리 → 합침", () => {
  it("🔴 하루 정규가 둘이어도 추측하지 않는다 — 보강이 기록된 반(앵커)의 정규 줄", () => {
    const p = planJoinMakeup({ subjects: [regularA, regularB, makeupOnA] }, "수학 (보강)", notSent);
    expect(p.ok && p.target.classId).toBe("BS2G");
  });
  it("앵커 반의 정규 줄이 없으면 막는다(다른 반에 합치지 않는다) · 반 없이 기록한 보강도", () => {
    expect(planJoinMakeup({ subjects: [regularB, makeupOnA] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "noRegular" });
    expect(planJoinMakeup({ subjects: [regularA, row({ ...makeupOnA, makeupClassId: null })] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "noRegular" });
  });
  it("정규 줄 출결이 결석·공결·보강이면 막는다 · 출석·지각·조퇴·기록 없음은 된다", () => {
    for (const raw of ["absent", "excused", "makeup"]) {
      expect(planJoinMakeup({ subjects: [row({ ...regularA, attendanceRaw: raw }), makeupOnA] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "attendance" });
    }
    for (const raw of [null, "present", "late", "early_leave"]) {
      expect(planJoinMakeup({ subjects: [row({ ...regularA, attendanceRaw: raw }), makeupOnA] }, "수학 (보강)", notSent).ok).toBe(true);
    }
  });
  it("어느 쪽이든 보냈거나 보내는 중이면 막는다", () => {
    expect(planJoinMakeup({ subjects: [regularA, makeupOnA] }, "수학 (보강)", (n) => n === "수학 (보강)")).toEqual({ ok: false, reason: "sent" });
    expect(planJoinMakeup({ subjects: [regularA, makeupOnA] }, "수학 (보강)", (n) => n === "수학 · BS2G")).toEqual({ ok: false, reason: "sent" });
  });
  it("그 반 정규 줄이 이미 '정규+보강'이면 · 보고서를 안 보내는 반이면 막는다", () => {
    expect(planJoinMakeup({ subjects: [row({ ...regularA, makeup: true }), makeupOnA] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "alreadyMerged" });
    expect(planJoinMakeup({ subjects: [row({ ...regularA, reportOptout: true }), makeupOnA] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "optout" });
  });
  it("과목이 다른 같은 반 줄에는 합치지 않는다", () => {
    expect(planJoinMakeup({ subjects: [row({ ...regularA, subjectKey: "english" }), makeupOnA] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "noRegular" });
  });
});

describe("planSplitMakeup — 합침 → 분리", () => {
  it("'정규+보강' 줄을 나눈다 · 같은 과목 보강 줄이 이미 있으면 · 보냈으면 막는다", () => {
    const merged = row({ ...regularA, makeup: true });
    expect(planSplitMakeup({ subjects: [merged] }, merged.name, notSent).ok).toBe(true);
    expect(planSplitMakeup({ subjects: [merged, makeupOnA] }, merged.name, notSent)).toEqual({ ok: false, reason: "hasSeparate" });
    expect(planSplitMakeup({ subjects: [merged] }, merged.name, () => true)).toEqual({ ok: false, reason: "sent" });
    expect(planSplitMakeup({ subjects: [regularA] }, regularA.name, notSent)).toEqual({ ok: false, reason: "gone" });
  });
});

describe("joinMakeupContent — 잃지 않게 이어 붙인다", () => {
  it("오늘 과제·특이사항은 잇고, 진도는 정규 줄이 비었을 때만 보강 줄 것", () => {
    const t = row({ today: "2-4-1 비의 성질", homeworkToday: "34-36p" });
    const s = row({ today: "2-4-3 비례식", homeworkToday: "38-41p", note: "보강 때 집중 잘함" });
    expect(joinMakeupContent(t, s, "학생 메모")).toEqual({ homeworkToday: "34-36p / 38-41p", note: "학생 메모\n보강 때 집중 잘함" });
    expect(joinMakeupContent(row({}), s, "").today).toBe("2-4-3 비례식");
  });
  it("보강 줄이 비었으면 아무것도 덮지 않는다 · 같은 글은 한 번", () => {
    expect(joinMakeupContent(row({ homeworkToday: "34p" }), row({}), "메모")).toEqual({});
    expect(joinText("34p", "34p", " / ")).toBe("34p");
  });
});
