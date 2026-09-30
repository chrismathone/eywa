import { describe, expect, it } from "vitest";
// 워커 .mjs — 앱·워커가 같은 순서로 반을 고르는지 한 표로 고정한다.
import { pickRouteClass } from "../../../scripts/_classnote/class-route-decide.mjs";
import {
  classRouteActive,
  classRouteAppliesTo,
  decideSendClass,
  isSendCandidateClass,
  sendClassGateRow,
  isSendClassRouteRow,
  liveBoardClassIdsOf,
  mineOnly,
  needsSendClass,
  pickMainClass,
  sendClassRow,
} from "./send-class";

describe("classRouteAppliesTo — 워커 class-route-decide.mjs와 같은 규칙", () => {
  it("class = 전원 · pilot = 고른 강사(원문 일치)만 · 그 외 = 아니다", () => {
    expect(classRouteAppliesTo({ classnoteMathRoute: "class" }, "누구")).toBe(true);
    expect(classRouteAppliesTo({ classnoteMathRoute: "pilot", classnoteMathRoutePilot: ["남정화"] }, "남정화")).toBe(true);
    expect(classRouteAppliesTo({ classnoteMathRoute: "pilot", classnoteMathRoutePilot: ["남정화"] }, " 남정화")).toBe(false);
    expect(classRouteAppliesTo({ classnoteMathRoute: "personal" }, "남정화")).toBe(false);
    expect(classRouteAppliesTo({}, "남정화")).toBe(false);
  });
});

describe("classRouteActive — ClassNote 모듈이 꺼진 학원은 반별 발송 판정 자체가 없다(원장 2026-09-30)", () => {
  const report = { classnoteMathRoute: "class" };
  it("모듈 켜짐 + 반별 = 켜짐", () => expect(classRouteActive({ modules: { disabled: [] }, report }, "누구")).toBe(true));
  it("🔴 모듈 꺼짐이면 설정이 반별이어도 꺼짐", () =>
    expect(classRouteActive({ modules: { disabled: ["classnote"] }, report }, "누구")).toBe(false));
  it("모듈 정보가 없으면 켜진 것으로(침산 — 꺼진 모듈 없음)", () => expect(classRouteActive({ report }, "누구")).toBe(true));
});

describe("needsSendClass", () => {
  it("수학 · 반 없음 · 반별 경로일 때만", () => {
    expect(needsSendClass({ subject: "math", classId: null }, true)).toBe(true);
    expect(needsSendClass({ subject: "subject_1" }, true)).toBe(true);
    expect(needsSendClass({ subject: "math", classId: "c1" }, true)).toBe(false);
    expect(needsSendClass({ subject: "english" }, true)).toBe(false);
    expect(needsSendClass({ subject: "math" }, false)).toBe(false);
  });
  it("🔴 반은 있어도 살아 있는 반 보드가 없으면(사라진 종강 반 등) 보낼 반이 필요하다 — 원장 2026-09-30", () => {
    // (특강은 2026-09-30부터 제 반 보드를 가진다 — 연결이 살아 있으면 true로 온다)
    expect(needsSendClass({ subject: "math", classId: "c1", classLive: false }, true)).toBe(true);
    expect(needsSendClass({ subject: "math", classId: "c1", classLive: true }, true)).toBe(false);
    // 확인 못 함(표 없음 등) = 예전처럼 둔다(워커가 판단)
    expect(needsSendClass({ subject: "math", classId: "c1", classLive: null }, true)).toBe(false);
    expect(needsSendClass({ subject: "math", classId: "c1", classLive: false }, false)).toBe(false);
  });
});

describe("pickMainClass", () => {
  it("후보가 하나면 그 반, 없으면 null", () => {
    expect(pickMainClass(["a"], {}, {})).toBe("a");
    expect(pickMainClass([], {}, {})).toBeNull();
  });
  it("보낸 보고서가 가장 많은 반", () => {
    expect(pickMainClass(["a", "b"], { a: 3, b: 7 }, { a: 99 })).toBe("b");
  });
  it("보고서가 동률이면 출결이 가장 많은 반", () => {
    expect(pickMainClass(["a", "b", "c"], { a: 5, b: 5, c: 1 }, { a: 2, b: 9, c: 50 })).toBe("b");
  });
  it("🔴 그래도 동률이면 정하지 않는다(강사가 고른다)", () => {
    expect(pickMainClass(["a", "b"], { a: 5, b: 5 }, { a: 3, b: 3 })).toBeNull();
    expect(pickMainClass(["a", "b"], {}, {})).toBeNull();
  });
});

describe("mineOnly — 작성 강사 담당 반만(원장 2026-09-29)", () => {
  const cs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("강사 = 담당 반만", () => {
    expect(mineOnly(cs, new Set(["b"]), true)).toEqual([{ id: "b" }]);
  });
  it("강사가 담당 반이 없으면 빈 목록(1인 보드로 — 남의 반에 올리지 않는다)", () => {
    expect(mineOnly(cs, new Set(), true)).toEqual([]);
  });
  it("관리자 = 담당 반이 있으면 그 반만, 없으면 전부", () => {
    expect(mineOnly(cs, new Set(["a", "c"]), false)).toEqual([{ id: "a" }, { id: "c" }]);
    expect(mineOnly(cs, new Set(), false)).toEqual(cs);
  });
});

describe("liveBoardClassIdsOf — 워커가 실제로 게시할 수 있는 반(앱·워커 한 규칙)", () => {
  it("대상 반 ∩ 연결 ∩ ok 멤버", () => {
    expect(liveBoardClassIdsOf(["a", "b", "c"], ["a", "b"], [{ classId: "a", status: "ok" }, { classId: "c", status: "ok" }])).toEqual(["a"]);
  });
  it("🔴 보류 행이 하나라도 있으면 아니다(워커 resolveClassTargets가 실패한다)", () => {
    expect(
      liveBoardClassIdsOf(["a"], ["a"], [
        { classId: "a", status: "ok" },
        { classId: "a", status: "hold" },
      ]),
    ).toEqual([]);
  });
  it("대상 반이 아니면(비활성·미발송·수학 아님) 연결이 있어도 아니다", () => {
    expect(liveBoardClassIdsOf([], ["a"], [{ classId: "a", status: "ok" }])).toEqual([]);
  });
});

describe("관리자 일괄 경로 입력 변환", () => {
  it("sendClassRow", () => {
    expect(sendClassRow({ id: "r", student_id: "s", class_id: null })).toEqual({ id: "r", studentId: "s", classId: null });
  });
  it("isSendClassRouteRow — 수학 + 반별 경로 + 모듈 켜짐", () => {
    const settings = { modules: { disabled: [] }, report: { classnoteMathRoute: "class" } };
    expect(isSendClassRouteRow(settings, { subject: "math", teacher_name: "누구" })).toBe(true);
    expect(isSendClassRouteRow(settings, { subject: "english", teacher_name: "누구" })).toBe(false);
    expect(isSendClassRouteRow({ ...settings, modules: { disabled: ["classnote"] } }, { subject: "math" })).toBe(false);
  });
});

describe("decideSendClass — 보강 추가한 반 우선(원장 2026-09-30 '애초에 보강 추가로 선택된 반에 보고서가 발송되면')", () => {
  const base = { candidates: ["a", "b"], makeupClassId: null, makeupLive: false, chosen: null, main: null };
  it("🔴 보강 반에 살아 있는 반 보드가 있으면 묻지 않고 그 반 — 후보·메인 수업·고른 반보다 먼저", () => {
    expect(decideSendClass({ ...base, makeupClassId: "m", makeupLive: true, main: "a" })).toEqual({ kind: "send", classId: "m", via: "makeup" });
    // 후보에 없어도(담당·종강 여부는 보강 등록 때 이미 확인) · 고른 반이 달라도(옛 화면) 보강 반
    expect(decideSendClass({ ...base, candidates: [], makeupClassId: "m", makeupLive: true })).toEqual({ kind: "send", classId: "m", via: "makeup" });
    expect(decideSendClass({ ...base, makeupClassId: "m", makeupLive: true, chosen: "a" })).toEqual({ kind: "send", classId: "m", via: "makeup" });
  });
  it("🔴 보강 반에 반 보드가 없으면 메인 수업이 정해져도 자동으로 보내지 않고 경고와 함께 묻는다(기본 = 메인 수업)", () => {
    expect(decideSendClass({ ...base, makeupClassId: "m", main: "a" })).toEqual({ kind: "ask", defaultId: "a", makeupMismatch: true });
    // 후보가 하나여도(pickMainClass가 그 반을 골라도) 묻는다
    expect(decideSendClass({ ...base, candidates: ["a"], makeupClassId: "m", main: "a" })).toEqual({ kind: "ask", defaultId: "a", makeupMismatch: true });
    expect(decideSendClass({ ...base, makeupClassId: "m" })).toEqual({ kind: "ask", defaultId: null, makeupMismatch: true });
  });
  it("경고를 본 뒤 고른 반은 받는다(후보 안에서만)", () => {
    expect(decideSendClass({ ...base, makeupClassId: "m", chosen: "b" })).toEqual({ kind: "send", classId: "b", via: "chosen" });
    expect(decideSendClass({ ...base, makeupClassId: "m", chosen: "x" }).kind).toBe("ask");
  });
  it("후보가 없으면 발송 불가(보강 반이 있었으면 그 사실도)", () => {
    expect(decideSendClass({ ...base, candidates: [], makeupClassId: "m" })).toEqual({ kind: "none", makeupMismatch: true });
    expect(decideSendClass({ ...base, candidates: [] })).toEqual({ kind: "none", makeupMismatch: false });
  });
  it("보강 반이 없는 보고서 = 예전 규칙(메인 수업 → 없으면 묻기)", () => {
    expect(decideSendClass({ ...base, main: "b" })).toEqual({ kind: "send", classId: "b", via: "auto" });
    expect(decideSendClass(base)).toEqual({ kind: "ask", defaultId: null, makeupMismatch: false });
    expect(decideSendClass({ ...base, chosen: "a", main: "b" })).toEqual({ kind: "send", classId: "a", via: "chosen" });
  });
  it("후보 밖 메인 수업은 쓰지 않는다", () => {
    expect(decideSendClass({ ...base, main: "z" })).toEqual({ kind: "ask", defaultId: null, makeupMismatch: false });
  });
});

describe("앱 ↔ 워커 한 규칙 — 앱이 적은 '보낼 반'과 워커가 실제로 올리는 반이 같다", () => {
  // 앱(원스크린·직접 작성): decideSendClass → classnote_class_id에 적는다. 워커: pickRouteClass(보고서 반 → 적힌 반 → 보강 반).
  const cases: { name: string; makeupLive: boolean; main?: string; chosen?: string }[] = [
    { name: "보강 반 보드 살아 있음 → 보강 반", makeupLive: true, main: "a" },
    { name: "보강 반 보드 없음 → 강사가 경고를 보고 b를 고름", makeupLive: false, chosen: "b" },
    { name: "보강 반 보드 없음 → 강사가 메인 수업 a를 그대로", makeupLive: false, chosen: "a" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      const app = decideSendClass({ candidates: ["a", "b"], makeupClassId: "m", makeupLive: c.makeupLive, chosen: c.chosen ?? null, main: c.main ?? null });
      expect(app.kind).toBe("send");
      const stored = app.kind === "send" ? app.classId : null;
      // 워커가 게시할 때 보강 반이 살아났든 죽었든 적힌 값을 따른다.
      for (const makeupEligible of [true, false]) {
        const worker = pickRouteClass({
          route: "needs_class",
          classId: null,
          sendClassId: stored,
          classEligible: false,
          sendEligible: true,
          makeupClassId: "m",
          makeupEligible,
        });
        expect(worker.classId).toBe(stored);
      }
    });
  }
  it("🔴 워커의 보강 반 조회 실패 = 대상 아님(적힌 값이 없으면 1인 보드로 두고 게이트가 막는다)", () => {
    const worker = pickRouteClass({ route: "needs_class", classId: null, sendClassId: null, classEligible: false, sendEligible: false, makeupClassId: "m", makeupEligible: false });
    expect(worker.route).toBe("personal");
    expect(sendClassGateRow({ classId: null, classLive: false, storedId: null, storedLive: false, makeupClassId: "m", makeupLive: false, sentAt: null }).pass).toBe(false);
  });
});

describe("sendClassGateRow — 관리자 일괄 게이트(워커와 같은 순서)", () => {
  const row = { classId: null as string | null, classLive: false, storedId: null as string | null, storedLive: false, makeupClassId: null as string | null, makeupLive: false, sentAt: null as string | null };
  it("보고서 반 → 적힌 보낼 반 → 보강 반 → 막기", () => {
    expect(sendClassGateRow({ ...row, classId: "c", classLive: true })).toEqual({ pass: true, rewriteTo: null });
    expect(sendClassGateRow({ ...row, storedId: "s", storedLive: true, makeupClassId: "m", makeupLive: true })).toEqual({ pass: true, rewriteTo: null });
    expect(sendClassGateRow({ ...row, makeupClassId: "m", makeupLive: true })).toEqual({ pass: true, rewriteTo: "m" });
    expect(sendClassGateRow({ ...row, storedId: "s", makeupClassId: "m", makeupLive: true })).toEqual({ pass: true, rewriteTo: "m" });
    expect(sendClassGateRow(row)).toEqual({ pass: false, rewriteTo: null });
  });
  it("🔴 이미 게시된 행(classnote_sent_at)은 '보낼 반'을 다시 적지 않는다(옛 위치 보존 — 회수)", () => {
    expect(sendClassGateRow({ ...row, makeupClassId: "m", makeupLive: true, sentAt: "2026-09-29T10:00:00Z" })).toEqual({ pass: true, rewriteTo: null });
  });
  it("보고서에 반이 있으면 보강 반을 보지 않는다", () => {
    expect(sendClassGateRow({ ...row, classId: "c", makeupClassId: "m", makeupLive: true }).pass).toBe(false);
  });
  it("🔴 게이트가 통과시킨 행은 워커도 반 보드로, 같은 반으로 간다(적은 뒤 상태로 모든 조합)", () => {
    const B = [true, false];
    for (const hasClass of B) for (const classLive of B) for (const hasStored of B) for (const storedLive of B) for (const hasMakeup of B) for (const makeupLive of B) for (const sent of B) {
      const r = {
        classId: hasClass ? "c" : null,
        classLive: hasClass && classLive,
        storedId: hasStored ? "s" : null,
        storedLive: hasStored && storedLive,
        makeupClassId: hasMakeup && !hasClass ? "m" : null,
        makeupLive: hasMakeup && !hasClass && makeupLive,
        sentAt: sent ? "2026-09-29" : null,
      };
      const g = sendClassGateRow(r);
      const storedAfter = g.rewriteTo ?? r.storedId;
      const worker = pickRouteClass({
        route: r.classId ? "class" : "needs_class",
        classId: r.classId,
        classEligible: r.classLive,
        sendClassId: storedAfter,
        sendEligible: g.rewriteTo ? true : r.storedLive,
        makeupClassId: r.makeupClassId,
        makeupEligible: r.makeupLive,
      });
      expect(worker.route === "class").toBe(g.pass);
      if (g.rewriteTo) expect(worker.classId).toBe(g.rewriteTo);
    }
  });
});

describe("isSendCandidateClass — 보낼 반 후보(원장 2026-09-30 '종강이 아닌 담당 반' · '보내는 반도 마찬가지')", () => {
  const c = { subject: "math", is_active: true, report_optout: false, closed_at: null as string | null };
  it("수학 · 활성 · 발송 · 종강 전", () => {
    expect(isSendCandidateClass(c, "2026-09-30")).toBe(true);
    expect(isSendCandidateClass({ ...c, subject: "subject_1" }, "2026-09-30")).toBe(true);
    expect(isSendCandidateClass({ ...c, subject: "english" }, "2026-09-30")).toBe(false);
    expect(isSendCandidateClass({ ...c, is_active: false }, "2026-09-30")).toBe(false);
    expect(isSendCandidateClass({ ...c, report_optout: true }, "2026-09-30")).toBe(false);
  });
  it("🔴 종강 반은 후보가 아니다 — 종강일 당일까지는 후보(시간표 isLiveSlot과 같은 경계)", () => {
    expect(isSendCandidateClass({ ...c, closed_at: "2026-09-29" }, "2026-09-30")).toBe(false);
    expect(isSendCandidateClass({ ...c, closed_at: "2026-09-30" }, "2026-09-30")).toBe(true);
    expect(isSendCandidateClass({ ...c, closed_at: "2026-10-31" }, "2026-09-30")).toBe(true);
  });
});
