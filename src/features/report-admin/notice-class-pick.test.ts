// 원생 개별 공지·교재요청서를 어느 반 보드로 보낼지 — 삼자 일치(보내는 선생님 – 반 – 학생) 판정.
import { describe, expect, it } from "vitest";
import { classTargetKey, pickNoticeClass, type NoticeClassCandidate } from "./notice-class-pick";

const cls = (over: Partial<NoticeClassCandidate> & { classId: string }): NoticeClassCandidate => ({
  className: over.classId,
  boardName: over.classId,
  taught: false,
  homeroom: false,
  ...over,
});

describe("강사 본인이 보낼 때(strict) — 선생님 다리가 문이다", () => {
  it("내 반 하나면 그 반", () => {
    const r = pickNoticeClass({ live: [cls({ classId: "A", taught: true, homeroom: true }), cls({ classId: "B" })], teacher: "strict" });
    expect(r).toMatchObject({ ok: true, classId: "A", via: "teacher" });
  });
  it("🔴 학생의 반 보드는 있지만 내 반이 아니면 보내지 않는다 — 남의 반 보드로 흘리지 않는다", () => {
    expect(pickNoticeClass({ live: [cls({ classId: "B" })], teacher: "strict" })).toEqual({ ok: false, reason: "not_my_class" });
    // 화면이 그 반을 골랐다고 해도 마찬가지(힌트는 후보 안에서만 쓴다)
    expect(pickNoticeClass({ live: [cls({ classId: "B" })], teacher: "strict", hints: ["B"] })).toEqual({ ok: false, reason: "not_my_class" });
  });
  it("내가 맡은 반은 있는데 그 반 보드가 없는 것과, 애초에 내 반 학생이 아닌 것은 사유가 다르다(고치는 길이 다르다)", () => {
    const live = [cls({ classId: "남의반" })];
    expect(pickNoticeClass({ live, teacher: "strict", teachesStudent: true })).toEqual({ ok: false, reason: "no_class_board" });
    expect(pickNoticeClass({ live, teacher: "strict", teachesStudent: false })).toEqual({ ok: false, reason: "not_my_class" });
  });
  it("내 반이 여럿이면 화면이 고른 반 → 담임인 반 → 반 이름순(매번 같은 반)", () => {
    const live = [cls({ classId: "나반", taught: true }), cls({ classId: "가반", taught: true }), cls({ classId: "다반", taught: true, homeroom: true })];
    expect(pickNoticeClass({ live, teacher: "strict", hints: ["나반"] })).toMatchObject({ ok: true, classId: "나반" });
    expect(pickNoticeClass({ live, teacher: "strict" })).toMatchObject({ ok: true, classId: "다반" });
    const noHome = live.map((c) => ({ ...c, homeroom: false }));
    expect(pickNoticeClass({ live: noHome, teacher: "strict" })).toMatchObject({ ok: true, classId: "가반" });
    // 후보 밖의 힌트는 무시한다
    expect(pickNoticeClass({ live, teacher: "strict", hints: ["없는반"] })).toMatchObject({ ok: true, classId: "다반" });
  });
});

describe("사무실이 요청서 주인 대신 보낼 때(prefer) — 선생님 다리는 우선순위다", () => {
  it("주인이 가르치는 반이 있으면 그 반", () => {
    const live = [cls({ classId: "가반" }), cls({ classId: "나반", taught: true })];
    expect(pickNoticeClass({ live, teacher: "prefer" })).toMatchObject({ ok: true, classId: "나반", via: "teacher" });
  });
  it("주인이 그 학생을 안 가르치면(사무실 직원이 직접 낸 요청 등) 학생의 반으로 — 막지 않는다", () => {
    expect(pickNoticeClass({ live: [cls({ classId: "가반" })], teacher: "prefer" })).toMatchObject({ ok: true, classId: "가반", via: "only" });
  });
});

describe("선생님 없는 발송(none) — 화면이 고른 반", () => {
  it("고른 반이 학생의 살아 있는 반 보드 안에 있으면 그 반(여러 반에서 뽑혔으면 먼저 고른 반)", () => {
    const live = [cls({ classId: "가반" }), cls({ classId: "나반" })];
    expect(pickNoticeClass({ live, teacher: "none", hints: ["나반", "가반"] })).toMatchObject({ ok: true, classId: "나반", via: "selected" });
  });
  it("고른 반에 반 보드가 없으면 학생의 다른 반 보드로(하나면 그 반 · 여럿이면 이름순 첫 반)", () => {
    expect(pickNoticeClass({ live: [cls({ classId: "가반" })], teacher: "none", hints: ["없는반"] })).toMatchObject({ ok: true, classId: "가반", via: "only" });
    expect(pickNoticeClass({ live: [cls({ classId: "나반" }), cls({ classId: "가반" })], teacher: "none" })).toMatchObject({ ok: true, classId: "가반", via: "first" });
  });
});

describe("공통", () => {
  it("🔴 받을 반 보드가 하나도 없으면 보내지 않는다(1인 보드로 되돌리지 않는다)", () => {
    for (const teacher of ["strict", "prefer", "none"] as const)
      expect(pickNoticeClass({ live: [], teacher, hints: ["가반"] })).toEqual({ ok: false, reason: "no_class_board" });
  });
  it("대상 키 — 한 반 보드에 여러 학생이 가므로 반 보드 이름 + 학생 이름으로 서로 구분된다", () => {
    expect(classTargetKey(" 중등M 중2 BS3O ", " 김수련 ")).toBe("중등M 중2 BS3O · 김수련");
    expect(classTargetKey("가반", "김민준")).not.toBe(classTargetKey("가반", "이서연"));
  });
});
