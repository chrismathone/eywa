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
  it("앵커 반의 정규 줄이 없으면 막는다(예약이 아닌 보강은 다른 반에 합치지 않는다) · 반 없이 기록한 보강은 '반 미정'", () => {
    expect(planJoinMakeup({ subjects: [regularB, makeupOnA] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "noRegular" });
    expect(planJoinMakeup({ subjects: [regularA, row({ ...makeupOnA, makeupClassId: null })] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "noAnchor" });
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

// 원장 2026-10-27 박지호 건 — 수요일 개별 JJ2L 결석분 보강 예약이 화요일 BS2P 정규 수업 날에 JJ2L로 기록돼 있었다.
describe("planJoinMakeup — 예약 보강을 오늘 정규 반으로 옮겨 합친다", () => {
  const booked = { start: "15:25", end: "16:20", absenceDate: "2026-10-21", mode: "separate" as const, done: false };
  const reservedOnJJ = row({ name: "수학 (보강)", classId: null, makeup: true, makeupClassId: "JJ2L", makeupClassName: "초등M 개별 JJ2L", makeupReserved: [booked] });
  const bs2p = row({ name: "수학 · BS2P", classId: "BS2P", makeup: false, attendanceRaw: "present" });

  it("앵커 반 정규 줄이 없고 오늘 같은 과목 정규 반이 하나면 그 반으로 옮겨 합친다(move)", () => {
    const p = planJoinMakeup({ subjects: [bs2p, reservedOnJJ] }, "수학 (보강)", notSent);
    expect(p.ok && p.move && p.target.classId).toBe("BS2P");
  });
  it("앵커 반에 오늘 정규 줄이 있으면 종전대로 그 반(옮기지 않는다)", () => {
    const jj = row({ name: "수학 · JJ2L", classId: "JJ2L", makeup: false, attendanceRaw: null });
    const p = planJoinMakeup({ subjects: [bs2p, jj, reservedOnJJ] }, "수학 (보강)", notSent);
    expect(p.ok && !p.move && p.target.classId).toBe("JJ2L");
  });
  it("🔴 정규 반이 둘이면 추측하지 않는다 — 고르게 하고, 고른 반으로만", () => {
    const bs2g = row({ name: "수학 · BS2G", classId: "BS2G", makeup: false, attendanceRaw: null });
    const p = planJoinMakeup({ subjects: [bs2p, bs2g, reservedOnJJ] }, "수학 (보강)", notSent);
    expect(p.ok).toBe(false);
    expect(!p.ok && p.reason === "pickRegular" && p.choices.map((c) => c.classId)).toEqual(["BS2P", "BS2G"]);
    const picked = planJoinMakeup({ subjects: [bs2p, bs2g, reservedOnJJ] }, "수학 (보강)", notSent, "BS2G");
    expect(picked.ok && picked.move && picked.target.classId).toBe("BS2G");
    expect(planJoinMakeup({ subjects: [bs2p, bs2g, reservedOnJJ] }, "수학 (보강)", notSent, "없는반")).toEqual({ ok: false, reason: "gone" });
  });
  it("🔴 이미 기록된 반 출석부에 찍힌(이행) 예약은 옮기지 않는다 — 시수가 두 번 선다", () => {
    const done = row({ ...reservedOnJJ, makeupReserved: [{ ...booked, done: true }] });
    expect(planJoinMakeup({ subjects: [bs2p, done] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "reservedDone" });
  });
  it("예약이 아닌 보강(반을 골라 둔 '+ 보강 학생 추가')은 다른 반으로 옮기지 않는다 — 그 칸은 이미 앵커 반에 섰다", () => {
    const added = row({ ...reservedOnJJ, makeupReserved: undefined });
    expect(planJoinMakeup({ subjects: [bs2p, added] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "noRegular" });
  });
  it("옮길 정규 줄의 조건은 같은 반 합침과 같다 — 출결·발송·보고서 안 보내는 반·이미 정규+보강·다른 과목·나눔 받는 줄", () => {
    for (const raw of ["absent", "excused", "makeup"]) {
      expect(planJoinMakeup({ subjects: [row({ ...bs2p, attendanceRaw: raw }), reservedOnJJ] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "attendance" });
    }
    expect(planJoinMakeup({ subjects: [bs2p, reservedOnJJ] }, "수학 (보강)", (n) => n === bs2p.name)).toEqual({ ok: false, reason: "sent" });
    expect(planJoinMakeup({ subjects: [row({ ...bs2p, reportOptout: true }), reservedOnJJ] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "optout" });
    expect(planJoinMakeup({ subjects: [row({ ...bs2p, makeup: true }), reservedOnJJ] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "alreadyMerged" });
    expect(planJoinMakeup({ subjects: [row({ ...bs2p, subjectKey: "english" }), reservedOnJJ] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "noRegular" });
    expect(planJoinMakeup({ subjects: [row({ ...bs2p, splitIn: "BS2X" }), reservedOnJJ] }, "수학 (보강)", notSent)).toEqual({ ok: false, reason: "noRegular" });
  });
});
