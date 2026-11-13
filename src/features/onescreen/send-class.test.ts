import { describe, expect, it } from "vitest";
// 워커 .mjs — 앱·워커가 같은 순서로 반을 고르는지 한 표로 고정한다.
import { decideRoute, pickRouteClass } from "../../../scripts/_classnote/class-route-decide.mjs";
import {
  classRouteActive,
  decideSendClass,
  isSendCandidateClass,
  sendClassGateRow,
  isSendClassRouteRow,
  liveBoardClassIdsOf,
  needsSendClass,
  pickMainClass,
  sendClassRow,
} from "./send-class";

describe("classRouteActive — 수학은 늘 반별, ClassNote 모듈이 꺼진 학원만 판정 자체가 없다(원장 2026-09-30 · 2026-11-05)", () => {
  it("모듈 켜짐 = 켜짐", () => expect(classRouteActive({ modules: { disabled: [] } })).toBe(true));
  it("🔴 모듈 꺼짐 = 꺼짐", () => expect(classRouteActive({ modules: { disabled: ["classnote"] } })).toBe(false));
  it("모듈 정보가 없으면 켜진 것으로(침산 — 꺼진 모듈 없음)", () => expect(classRouteActive({})).toBe(true));
  it("🔴 옛 '수학 발송 경로' 저장값(기존 방식·일부 선생님만)은 판정에 쓰지 않는다(2026-11-05 걷음 — 강사 이름 인자도 없앰)", () => {
    const old = { modules: { disabled: [] }, report: { classnoteMathRoute: "personal", classnoteMathRoutePilot: ["남정화"] } };
    expect(classRouteActive(old)).toBe(true);
    const pilotOld = { ...old, report: { classnoteMathRoute: "pilot", classnoteMathRoutePilot: [] as string[] } };
    expect(classRouteActive(pilotOld)).toBe(true);
    // 인자는 설정 하나뿐 — 옛 '일부 선생님만' 자리(강사 이름)를 다시 받지 않는다.
    expect(classRouteActive.length).toBe(1);
  });
});

describe("앱·워커 같은 규칙 — 수학이면 늘 반별(워커 class-route-decide.mjs `decideRoute`)", () => {
  it("수학(math·subject_1) = 반 있으면 class · 반 없으면(보강) needs_class · 그 밖 과목 = personal(이 판정과 무관)", () => {
    const anyTeacher = { subject: "math", class_id: "c1", teacher_name: "아무나" }; // 작성 강사는 보지 않는다
    expect(decideRoute(anyTeacher)).toBe("class");
    expect(decideRoute({ subject: "subject_1", class_id: "c1" })).toBe("class");
    expect(decideRoute({ subject: "math", class_id: null })).toBe("needs_class");
    expect(decideRoute({ subject: "english", class_id: "c1" })).toBe("personal");
    // 앱 쪽 같은 표: 모듈이 켜진 학원의 수학 행은 반별 게이트를 탄다.
    expect(isSendClassRouteRow({ modules: { disabled: [] } }, { subject: "math" })).toBe(true);
    expect(isSendClassRouteRow({ modules: { disabled: [] } }, { subject: "english" })).toBe(false);
  });
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
  it("isSendClassRouteRow — 수학 + 모듈 켜짐", () => {
    const settings = { modules: { disabled: [] } };
    expect(isSendClassRouteRow(settings, { subject: "math", teacher_name: "누구" })).toBe(true);
    expect(isSendClassRouteRow(settings, { subject: "english", teacher_name: "누구" })).toBe(false);
    expect(isSendClassRouteRow({ ...settings, modules: { disabled: ["classnote"] } }, { subject: "math" })).toBe(false);
  });
});

describe("decideSendClass — 🔴 보강 보고서의 발송 반 = 보강 반(원장 2026-09-30 '보고서 반 = 출석부 반')", () => {
  const base = { candidates: ["a", "b"], makeupClassId: null as string | null, makeupLive: false, main: null as string | null };
  it("보강 반에 살아 있는 반 보드가 있으면 묻지 않고 그 반 — 후보·메인 수업과 무관", () => {
    expect(decideSendClass({ ...base, makeupClassId: "m", makeupLive: true, main: "a" })).toEqual({ kind: "send", classId: "m", via: "makeup" });
    expect(decideSendClass({ ...base, candidates: [], makeupClassId: "m", makeupLive: true })).toEqual({ kind: "send", classId: "m", via: "makeup" });
  });
  it("🔴 보강 반 보드가 없으면 자동으로 다른 반에 보내지 않고 묻는다(기본 = 메인 수업) — 고른 반은 새 보강 반이 된다", () => {
    expect(decideSendClass({ ...base, makeupClassId: "m", main: "a" })).toEqual({ kind: "ask", defaultId: "a", makeupMismatch: true });
    expect(decideSendClass({ ...base, candidates: ["a"], makeupClassId: "m", main: "a" })).toEqual({ kind: "ask", defaultId: "a", makeupMismatch: true });
  });
  it("🔴 반 미정 보강(보강 반 없음)도 메인 수업이 정해져 있어도 **자동 발송하지 않는다** — 묻는다(C9 · 반 없는 발송 금지)", () => {
    expect(decideSendClass({ ...base, main: "b" })).toEqual({ kind: "ask", defaultId: "b", makeupMismatch: false });
    expect(decideSendClass(base)).toEqual({ kind: "ask", defaultId: null, makeupMismatch: false });
  });
  it("후보가 없으면 발송 불가(보강 반이 있었으면 그 사실도)", () => {
    expect(decideSendClass({ ...base, candidates: [], makeupClassId: "m" })).toEqual({ kind: "none", makeupMismatch: true });
    expect(decideSendClass({ ...base, candidates: [] })).toEqual({ kind: "none", makeupMismatch: false });
  });
  it("후보 밖 메인 수업은 기본값으로 쓰지 않는다", () => {
    expect(decideSendClass({ ...base, main: "z" })).toEqual({ kind: "ask", defaultId: null, makeupMismatch: false });
  });
});

describe("sendClassGateRow — 관리자 일괄 게이트(워커와 같은 판정 · 원장 2026-09-30)", () => {
  const row = { classId: null as string | null, classLive: false, storedId: null as string | null, storedLive: false, makeupClassId: null as string | null, makeupLive: false, sentAt: null as string | null };
  it("정규 보고서 = 그 반 보드만 — 죽었으면 적힌 '보낼 반'이 살아 있어도 막는다(원장 결정 4: 다른 반으로 보내지 않는다)", () => {
    expect(sendClassGateRow({ ...row, classId: "c", classLive: true })).toEqual({ pass: true, rewriteTo: null });
    expect(sendClassGateRow({ ...row, classId: "c", classLive: false, storedId: "s", storedLive: true })).toEqual({ pass: false, rewriteTo: null });
  });
  it("보강 보고서 = 보강 반만 — 적힌 '보낼 반'을 보강 반으로 맞춘다", () => {
    expect(sendClassGateRow({ ...row, makeupClassId: "m", makeupLive: true })).toEqual({ pass: true, rewriteTo: "m" });
    expect(sendClassGateRow({ ...row, storedId: "m", makeupClassId: "m", makeupLive: true })).toEqual({ pass: true, rewriteTo: null });
  });
  it("보강 반과 다른 전달 반은 별도로 검증됐을 때만 통과한다", () => {
    expect(sendClassGateRow({ ...row, storedId: "s", storedLive: true, makeupClassId: "m", makeupLive: false })).toEqual({ pass: true, rewriteTo: null });
    expect(sendClassGateRow({ ...row, storedId: "s", storedLive: false, makeupClassId: "m", makeupLive: true })).toEqual({ pass: false, rewriteTo: null });
  });
  it("🔴 반 미정 보강은 적힌 '보낼 반'이 살아 있어도 막는다", () => {
    expect(sendClassGateRow({ ...row, storedId: "s", storedLive: true })).toEqual({ pass: false, rewriteTo: null });
    expect(sendClassGateRow(row)).toEqual({ pass: false, rewriteTo: null });
  });
  it("🔴 이미 게시된 행(classnote_sent_at)은 '보낼 반'을 다시 적지 않는다(옛 위치 보존 — 회수)", () => {
    expect(sendClassGateRow({ ...row, makeupClassId: "m", makeupLive: true, sentAt: "2026-09-29T10:00:00Z" })).toEqual({ pass: true, rewriteTo: null });
  });
  it("보강 반 보드가 없으면 막는다", () => {
    expect(sendClassGateRow({ ...row, makeupClassId: "m", makeupLive: false }).pass).toBe(false);
  });
});

describe("🔴 앱 ↔ 워커 한 규칙 — 게이트가 통과시킨 행만 워커가 반 보드로, **같은 반**으로 올린다(모든 조합 128)", () => {
  it("통과 ⇔ 워커 class · 반 = (정규: 보고서 반 / 보강: 보강 반) · 막힘 ⇔ 워커 blocked(1인 보드로 흘리지 않는다)", () => {
    const B = [true, false];
    let n = 0;
    for (const hasClass of B) for (const classLive of B) for (const hasStored of B) for (const storedIsMakeup of B) for (const hasMakeup of B) for (const makeupLive of B) for (const sent of B) for (const deliveryLive of B) {
      n++;
      const makeupClassId = hasMakeup && !hasClass ? "m" : null;
      const r = {
        classId: hasClass ? "c" : null,
        classLive: hasClass && classLive,
        storedId: hasStored ? (storedIsMakeup && makeupClassId ? makeupClassId : "s") : null,
        storedLive: hasStored && deliveryLive,
        makeupClassId,
        makeupLive: !!makeupClassId && makeupLive,
        sentAt: sent ? "2026-09-29" : null,
      };
      const g = sendClassGateRow(r);
      const storedAfter = g.rewriteTo ?? r.storedId;
      const worker = pickRouteClass({
        route: r.classId ? "class" : "needs_class",
        classId: r.classId,
        classEligible: r.classLive,
        sendClassId: storedAfter,
        makeupClassId: r.makeupClassId,
        makeupEligible: r.makeupLive,
        sendEligible: r.storedLive,
      });
      expect(worker.route === "class").toBe(g.pass);
      expect(worker.route === "personal").toBe(false); // 반별 경로에서 1인 보드로 새지 않는다
      if (g.pass) expect(worker.classId).toBe(r.classId ?? storedAfter ?? r.makeupClassId);
    }
    expect(n).toBe(256);
  });
  it("앱(decideSendClass)이 보내겠다고 한 반 = 워커가 올리는 반(보강 반)", () => {
    const app = decideSendClass({ candidates: ["a"], makeupClassId: "m", makeupLive: true, main: "a" });
    expect(app).toEqual({ kind: "send", classId: "m", via: "makeup" });
    // 저장이 '보낼 반'을 보강 반의 복사본으로 적는다 → 워커는 같은 반
    const worker = pickRouteClass({ route: "needs_class", classId: null, classEligible: false, sendClassId: "m", makeupClassId: "m", makeupEligible: true });
    expect(worker).toEqual({ route: "class", classId: "m", via: "makeup" });
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
