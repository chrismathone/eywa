import { describe, expect, it } from "vitest";

import { filterUnsentSendable, isUnsentSendable, hasSendableMent, type UnsentRow } from "./unsent-sendable";

const TODAY = "2026-09-09";

function row(over: Partial<UnsentRow> = {}): UnsentRow {
  return {
    id: "r1",
    studentId: "s1",
    reportDate: "2026-09-08",
    subject: "math",
    classId: "c1",
    makeup: false,
    ment: "오늘 잘했습니다.",
    ...over,
  };
}

const ctx = (over: Partial<Parameters<typeof isUnsentSendable>[1]> = {}) => ({
  today: TODAY,
  classnoteSubjects: ["math"],
  optoutClassIds: new Set<string>(),
  absenceBlockedKeys: new Set<string>(),
  absenceKeyOf: (r: UnsentRow) => `${r.studentId}|${r.reportDate}|c:${r.classId}`,
  ...over,
});

describe("미발송 보고서 발송 가능 판정", () => {
  it("실데이터(2026-09-08 중등M 5건)는 보낼 수 있다 — 알림이 옳았다", () => {
    expect(isUnsentSendable(row(), ctx())).toBe(true);
  });

  it("발송 기한(오늘 포함 7일) 밖은 세지 않는다 — 어떤 경로로도 못 나간다", () => {
    expect(isUnsentSendable(row({ reportDate: "2026-09-02" }), ctx())).toBe(false);
    expect(isUnsentSendable(row({ reportDate: "2026-09-03" }), ctx())).toBe(true);
  });

  it("과목 opt-in 밖(영어)은 세지 않는다", () => {
    expect(isUnsentSendable(row({ subject: "english" }), ctx())).toBe(false);
    expect(isUnsentSendable(row({ subject: null }), ctx())).toBe(false);
  });

  it("'수업보고서 미발송' 반(0174a)은 세지 않는다", () => {
    expect(isUnsentSendable(row(), ctx({ optoutClassIds: new Set(["c1"]) }))).toBe(false);
  });

  it("멘트가 비면 세지 않는다 — 발송 콘솔이 거절하는 건을 재촉하지 않는다", () => {
    expect(isUnsentSendable(row({ ment: "" }), ctx())).toBe(false);
    expect(isUnsentSendable(row({ ment: "   \n " }), ctx())).toBe(false);
    expect(isUnsentSendable(row({ ment: null }), ctx())).toBe(false);
  });

  it("그날 결석이면 세지 않는다 — 단 보강 보고서는 예외(발송 콘솔과 같은 규약)", () => {
    const blocked = ctx({ absenceBlockedKeys: new Set(["s1|2026-09-08|c:c1"]) });
    expect(isUnsentSendable(row(), blocked)).toBe(false);
    expect(isUnsentSendable(row({ makeup: true }), blocked)).toBe(true);
  });

  it("여러 건을 한 번에 거른다(순서 보존 — 첫 건이 가장 오래된 건)", () => {
    const rows = [
      row({ id: "old", reportDate: "2026-09-07" }),
      row({ id: "noment", reportDate: "2026-09-08", ment: " " }),
      row({ id: "ok", reportDate: "2026-09-08" }),
    ];
    expect(filterUnsentSendable(rows, ctx()).map((r) => r.id)).toEqual(["old", "ok"]);
  });

  it("hasSendableMent — 공백만 있으면 없는 것", () => {
    expect(hasSendableMent("한 줄")).toBe(true);
    expect(hasSendableMent(" \t\n")).toBe(false);
    expect(hasSendableMent(undefined)).toBe(false);
  });
});
