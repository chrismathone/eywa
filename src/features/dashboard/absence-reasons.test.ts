import { describe, expect, it } from "vitest";
import {
  absenceReasonTail,
  isPreNotified,
  normalizeReason,
  summarizeAbsenceReasons,
} from "./absence-reasons";
import type { AbsenceSubjectRow } from "./absence-subjects";

const row = (o: Partial<AbsenceSubjectRow> & { id: string }): AbsenceSubjectRow => ({
  student_id: "s1",
  class_id: "c1",
  session_date: "2026-08-20",
  slot_start: null,
  status: "absent",
  recorded_at: "2026-08-20T09:00:00Z",
  subject: "math",
  note: null,
  ...o,
});

describe("normalizeReason", () => {
  it("데스크 접수 표식을 뗀다(건수가 이미 말하므로 두 번 말하지 않는다)", () => {
    expect(normalizeReason("가족여행 (데스크 접수)")).toBe("가족여행");
    expect(normalizeReason("병결(입원) (데스크 접수)")).toBe("병결(입원)");
  });

  it("여러 줄이면 첫 줄만 쓴다", () => {
    // 실측: "가족여행 (데스크 접수)\n개인 사정 (데스크 접수)" 같은 행이 있다.
    expect(normalizeReason("가족여행 (데스크 접수)\n개인 사정 (데스크 접수)")).toBe("가족여행");
  });

  it("긴 사유는 자르고 말줄임을 붙인다", () => {
    expect(normalizeReason("미술학원 -> 다음 주 월요일 정규수업 이후 연강으로 보강 예정")).toBe(
      "미술학원 -> 다음 주 월요일…",
    );
  });

  it("빈 값·공백은 빈 문자열", () => {
    expect(normalizeReason(null)).toBe("");
    expect(normalizeReason("   ")).toBe("");
    expect(normalizeReason("(데스크 접수)")).toBe("");
  });
});

describe("isPreNotified — 두 갈래의 합집합", () => {
  it("데스크 접수 표식이 있으면 사전 통보다", () => {
    expect(isPreNotified({ note: "가족여행 (데스크 접수)", recorded_at: null, session_date: "2026-08-20" })).toBe(true);
  });

  it("수업일 **전에** 찍었으면 사전 통보다", () => {
    expect(isPreNotified({ note: null, recorded_at: "2026-08-18T05:00:00Z", session_date: "2026-08-20" })).toBe(true);
  });

  it("당일·사후 기록은 사전 통보가 아니다", () => {
    expect(isPreNotified({ note: "병결", recorded_at: "2026-08-20T09:00:00Z", session_date: "2026-08-20" })).toBe(false);
    expect(isPreNotified({ note: "병결", recorded_at: "2026-08-22T09:00:00Z", session_date: "2026-08-20" })).toBe(false);
  });

  it("🔴 KST로 판정한다 — UTC로 자르면 하루가 어긋난다", () => {
    // 8/19 23:00 KST(= 08-19T14:00Z) → 수업일 전날에 찍었다.
    expect(isPreNotified({ note: null, recorded_at: "2026-08-19T14:00:00Z", session_date: "2026-08-20" })).toBe(true);
    // 8/20 00:30 KST(= 08-19T15:30Z) → 이미 수업일 당일이다. UTC로 자르면 08-19라 **전날로 오판**한다.
    expect(isPreNotified({ note: null, recorded_at: "2026-08-19T15:30:00Z", session_date: "2026-08-20" })).toBe(false);
    // 8/20 08:00 KST(= 08-19T23:00Z) → 같은 함정, 더 뚜렷한 시각.
    expect(isPreNotified({ note: null, recorded_at: "2026-08-19T23:00:00Z", session_date: "2026-08-20" })).toBe(false);
  });

  it("recorded_at이 없으면 사전 통보로 보지 않는다(모르면 아니라고 한다)", () => {
    expect(isPreNotified({ note: "가족여행", recorded_at: null, session_date: "2026-08-20" })).toBe(false);
  });
});

describe("summarizeAbsenceReasons", () => {
  it("사전 통보 건수와 사유를 함께 낸다", () => {
    const out = summarizeAbsenceReasons([
      row({ id: "1", session_date: "2026-08-18", note: "가족여행 (데스크 접수)" }),
      row({ id: "2", session_date: "2026-08-19", note: "가족여행 (데스크 접수)" }),
      row({ id: "3", session_date: "2026-08-20", note: "병결" }),
    ]);
    expect(out.get("s1")).toEqual({ preNotified: 2, reasons: ["가족여행", "병결"], withoutReason: 0 });
  });

  it("사유 없는 건수를 따로 센다", () => {
    const out = summarizeAbsenceReasons([
      row({ id: "1", session_date: "2026-08-18" }),
      row({ id: "2", session_date: "2026-08-19", note: "여행" }),
    ]);
    expect(out.get("s1")).toEqual({ preNotified: 0, reasons: ["여행"], withoutReason: 1 });
  });

  it("🔴 세는 단위가 과목 분해와 같다 — 같은 반·같은 날 두 교시는 1건", () => {
    // 안 그러면 "결석 1회"인데 "사전 통보 2"가 되어 화면에서 바로 거짓이 드러난다.
    const out = summarizeAbsenceReasons([
      row({ id: "1", slot_start: "16:20", note: "가족여행 (데스크 접수)" }),
      row({ id: "2", slot_start: "17:20", note: "가족여행 (데스크 접수)" }),
    ]);
    expect(out.get("s1")?.preNotified).toBe(1);
  });

  it("정정된 행(출석으로 바뀜)은 세지 않는다", () => {
    const out = summarizeAbsenceReasons([
      row({ id: "1", recorded_at: "2026-08-20T09:00:00Z", note: "병결" }),
      row({ id: "2", recorded_at: "2026-08-20T10:00:00Z", status: "present" }),
    ]);
    expect(out.get("s1")).toBeUndefined();
  });

  it("사유는 중복을 접고 순서가 결정적이다(수업일 순)", () => {
    const out = summarizeAbsenceReasons([
      row({ id: "2", session_date: "2026-08-21", note: "병결" }),
      row({ id: "1", session_date: "2026-08-19", note: "여행" }),
      row({ id: "3", session_date: "2026-08-22", class_id: "c2", note: "여행" }),
    ]);
    expect(out.get("s1")?.reasons).toEqual(["여행", "병결"]);
  });
});

describe("absenceReasonTail", () => {
  it("화면엔 사전 통보 + 사유", () => {
    expect(absenceReasonTail({ preNotified: 5, reasons: ["가족여행"], withoutReason: 0 })).toBe(
      " · 사전 통보 5 · 가족여행",
    );
  });

  it("🔴 프롬프트엔 사유 원문을 빼고 건수만 — 자유 텍스트에 건강 정보가 섞여 있다", () => {
    expect(
      absenceReasonTail({ preNotified: 5, reasons: ["병결(입원)"], withoutReason: 0 }, { forPrompt: true }),
    ).toBe(" · 사전 통보 5");
  });

  it("사전 통보가 없으면 사유만", () => {
    expect(absenceReasonTail({ preNotified: 0, reasons: ["병결"], withoutReason: 2 })).toBe(" · 병결");
  });

  it("아무것도 없으면 빈 문자열(줄이 지저분해지지 않게)", () => {
    expect(absenceReasonTail({ preNotified: 0, reasons: [], withoutReason: 3 })).toBe("");
    expect(absenceReasonTail(undefined)).toBe("");
  });
});
