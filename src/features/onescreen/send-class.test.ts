import { describe, expect, it } from "vitest";
import {
  classRouteActive,
  classRouteAppliesTo,
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
