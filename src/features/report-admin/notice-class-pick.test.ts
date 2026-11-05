// 원생 개별 공지·교재요청서를 어느 반 보드로 보낼지 — 삼자 일치(보내는 선생님 – 반 – 학생) 판정.
import { describe, expect, it } from "vitest";
import {
  classTargetKey,
  isJjClassName,
  pickEnglishNoticeClass,
  pickNoticeClass,
  type EnglishNoticeClass,
  type NoticeClassCandidate,
} from "./notice-class-pick";

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

describe("JJ 반은 후순위(원장 2026-10-20)", () => {
  const jj = cls({ classId: "jj", className: "초등M 개별 JJ2K", taught: true, homeroom: true });
  const bs = cls({ classId: "bs", className: "초등M 초6 BS2P", taught: true, homeroom: true });
  it("🔴 이강우 실례 — 같은 선생님 담임 반 둘(JJ2K·BS2P)이면 이름순이 아니라 BS2P", () => {
    for (const teacher of ["strict", "prefer"] as const)
      expect(pickNoticeClass({ live: [jj, bs], teacher })).toMatchObject({ ok: true, classId: "bs", via: "teacher" });
  });
  it("JJ 반만 담임이어도 JJ가 아닌 내 반이 먼저다", () => {
    expect(pickNoticeClass({ live: [jj, { ...bs, homeroom: false }], teacher: "strict" })).toMatchObject({ classId: "bs" });
  });
  it("JJ 반밖에 없으면 그 반으로 보낸다(막지 않는다)", () => {
    expect(pickNoticeClass({ live: [jj], teacher: "strict" })).toMatchObject({ ok: true, classId: "jj" });
    expect(pickNoticeClass({ live: [jj, { ...bs, taught: false, homeroom: false }], teacher: "strict" })).toMatchObject({ classId: "jj" });
  });
  it("화면이 고른 반은 JJ여도 그대로", () => {
    expect(pickNoticeClass({ live: [jj, bs], teacher: "strict", hints: ["jj"] })).toMatchObject({ classId: "jj" });
    expect(pickNoticeClass({ live: [jj, bs], teacher: "none", hints: ["jj"] })).toMatchObject({ classId: "jj", via: "selected" });
  });
  it("선생님 없는 발송도 JJ가 아닌 반이 첫 반", () => {
    const plain = [jj, bs].map((c) => ({ ...c, taught: false, homeroom: false }));
    expect(pickNoticeClass({ live: plain, teacher: "none" })).toMatchObject({ classId: "bs", via: "first" });
  });
  it("JJ 판정 = 반 이름의 코드가 JJ로 시작", () => {
    for (const n of ["초등M 개별 JJ2K", "중등M 중2 JJPS", "중등M 초6 JJ2A", "초등M 개별JJ1E"]) expect(isJjClassName(n)).toBe(true);
    for (const n of ["초등M 초6 BS2P", "초등M 개별 EL1K", "고등M 개별 TP4E", "내신주말특강(일)"]) expect(isJjClassName(n)).toBe(false);
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

describe("영어 개별 공지 — 반을 삼자 일치로 정하고, 그 반에 반 방이 있으면 반 방 · 없으면 지금처럼 1인 보드(원장 2026-11-04)", () => {
  const en = (over: Partial<EnglishNoticeClass> & { classId: string }): EnglishNoticeClass => ({
    className: over.classId,
    room: null,
    taught: false,
    homeroom: false,
    ...over,
  });
  it("내가 맡은 반에 반 방이 있으면 그 반 방(표시 키는 반 방 이름)", () => {
    const r = pickEnglishNoticeClass({ classes: [en({ classId: "LE2", room: "Jennifer LE2 (월수)", taught: true })], teacher: "strict" });
    expect(r).toEqual({ route: "room", classId: "LE2", className: "LE2", boardName: "Jennifer LE2 (월수)", via: "teacher" });
  });
  it("🔴 내가 맡은 반에 반 방이 없으면 1인 보드 — 남의 반 방(같은 학생이 다니는 다른 선생님 반)으로 옮기지 않는다", () => {
    const classes = [en({ classId: "내반", taught: true }), en({ classId: "남의반", room: "남의 반 방" })];
    expect(pickEnglishNoticeClass({ classes, teacher: "strict" })).toEqual({ route: "personal" });
    // 화면이 남의 반을 골라 보냈어도 마찬가지(힌트는 내 반 안에서만)
    expect(pickEnglishNoticeClass({ classes, teacher: "strict", hints: ["남의반"] })).toEqual({ route: "personal" });
  });
  it("🔴 강사 본인 발송인데 이 학생의 영어 반을 하나도 맡지 않았으면 반 방으로 보내지 않는다(지금처럼 1인 보드)", () => {
    expect(pickEnglishNoticeClass({ classes: [en({ classId: "A", room: "A 방" })], teacher: "strict" })).toEqual({ route: "personal" });
  });
  it("영어 반이 없으면(휴원·끝난 수강 등) 1인 보드", () => {
    for (const teacher of ["strict", "prefer", "none"] as const) expect(pickEnglishNoticeClass({ classes: [], teacher })).toEqual({ route: "personal" });
  });
  it("내 반이 둘이면 화면이 고른 반 → 반 방 있는 반 → 담임 반 → 이름순", () => {
    const classes = [en({ classId: "가반", taught: true, homeroom: true }), en({ classId: "나반", room: "나 방", taught: true })];
    // 화면이 고른 반이 반 방 없는 반이면 그 반의 일 — 1인 보드(다른 반 방으로 옮기지 않는다)
    expect(pickEnglishNoticeClass({ classes, teacher: "strict", hints: ["가반"] })).toEqual({ route: "personal" });
    expect(pickEnglishNoticeClass({ classes, teacher: "strict", hints: ["나반"] })).toMatchObject({ route: "room", classId: "나반" });
    // 고른 반이 없으면 반 방이 있는 반이 담임 반보다 먼저(1인 보드가 없는 신입도 받는다)
    expect(pickEnglishNoticeClass({ classes, teacher: "strict" })).toMatchObject({ route: "room", classId: "나반", via: "teacher" });
    const both = [en({ classId: "나반", room: "나 방", taught: true }), en({ classId: "가반", room: "가 방", taught: true, homeroom: false }), en({ classId: "다반", room: "다 방", taught: true, homeroom: true })];
    expect(pickEnglishNoticeClass({ classes: both, teacher: "strict" })).toMatchObject({ classId: "다반" });
    expect(pickEnglishNoticeClass({ classes: both.map((c) => ({ ...c, homeroom: false })), teacher: "strict" })).toMatchObject({ classId: "가반" });
  });
  it("🔴 고른 반이 여럿이면 고른 순서와 무관하게 반 방 있는 반(리뷰 2026-11-04 — 수강 행 순서에 따라 갈리던 것)", () => {
    const classes = [en({ classId: "가반", taught: true }), en({ classId: "나반", room: "나 방", taught: true })];
    for (const hints of [["가반", "나반"], ["나반", "가반"]])
      for (const teacher of ["strict", "prefer", "none"] as const)
        expect(pickEnglishNoticeClass({ classes, teacher, hints })).toMatchObject({ route: "room", classId: "나반" });
  });
  it("고른 반이 둘 다 반 방 있는 내 반이면 고르지 않았을 때와 같은 순서 — 담임 반 먼저(재리뷰 2026-11-04)", () => {
    const classes = [en({ classId: "가반", room: "가 방", taught: true }), en({ classId: "나반", room: "나 방", taught: true, homeroom: true })];
    expect(pickEnglishNoticeClass({ classes, teacher: "strict" })).toMatchObject({ classId: "나반" });
    for (const hints of [["가반", "나반"], ["나반", "가반"]]) expect(pickEnglishNoticeClass({ classes, teacher: "strict", hints })).toMatchObject({ classId: "나반" });
  });
  it("사무실 발송(선생님 없음) = 고른 반 → 없으면 반 방 있는 반 → 이름순", () => {
    const classes = [en({ classId: "가반" }), en({ classId: "나반", room: "나 방" })];
    expect(pickEnglishNoticeClass({ classes, teacher: "none", hints: ["가반"] })).toEqual({ route: "personal" });
    expect(pickEnglishNoticeClass({ classes, teacher: "none", hints: ["나반"] })).toMatchObject({ route: "room", classId: "나반", via: "selected" });
    expect(pickEnglishNoticeClass({ classes, teacher: "none" })).toMatchObject({ route: "room", classId: "나반", via: "first" });
    expect(pickEnglishNoticeClass({ classes: [en({ classId: "가반", room: "가 방" })], teacher: "none" })).toMatchObject({ route: "room", via: "only" });
  });
  it("사무실이 요청서 주인 대신(prefer) — 주인이 맡은 반 → 없으면 사무실 규칙", () => {
    const classes = [en({ classId: "가반", room: "가 방" }), en({ classId: "나반", room: "나 방", taught: true })];
    expect(pickEnglishNoticeClass({ classes, teacher: "prefer" })).toMatchObject({ route: "room", classId: "나반", via: "teacher" });
    expect(pickEnglishNoticeClass({ classes: classes.map((c) => ({ ...c, taught: false })), teacher: "prefer" })).toMatchObject({ classId: "가반", via: "first" });
  });
});
