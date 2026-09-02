import { describe, expect, it } from "vitest";
import { ASSIGNED_LABEL } from "./board-stages";
import { OUTCOME_PILL } from "./outcome-meta";
import {
  SHEET_LEGEND,
  callDateOf,
  noteLines,
  sheetDate,
  sheetDateDow,
  statusCellOf,
  subjectTokens,
  wonLabel,
} from "./sheet-cells";

describe("시트 날짜 표기 — M/D · 요일", () => {
  it("YYYY-MM-DD를 시트의 M/D로 적는다(0을 뗀다)", () => {
    expect(sheetDate("2026-08-05")).toBe("8/5");
    expect(sheetDate("2025-12-31")).toBe("12/31");
  });
  it("날짜 형식이 아니면 지어내지 않는다", () => {
    expect(sheetDate(null)).toBeNull();
    expect(sheetDate("")).toBeNull();
    expect(sheetDate("7/7 5:00")).toBeNull();
  });
  it("상담일은 요일을 붙인다(시트의 상담일자+요일 두 칸)", () => {
    expect(sheetDateDow("2026-08-31")).toBe("8/31 (월)");
    expect(sheetDateDow("2026-09-05")).toBe("9/5 (토)");
    expect(sheetDateDow(null)).toBeNull();
  });
});

describe("콜일자 — 접수일 우선, 없으면 접수 시각의 KST 날짜", () => {
  it("received_date가 있으면 그 값", () => {
    expect(callDateOf({ receivedDate: "2026-08-27", consultedAt: "2026-08-27T05:43:48.024Z" })).toBe(
      "2026-08-27",
    );
  });
  it("없으면 consulted_at을 KST로 접는다 — UTC 자정 전 접수가 하루 밀리지 않는다", () => {
    // 2026-08-31 15:30Z = KST 9/1 00:30. slice(0,10)이면 8/31로 틀린다.
    expect(callDateOf({ receivedDate: null, consultedAt: "2026-08-31T15:30:00Z" })).toBe("2026-09-01");
  });
});

describe("과목 칸 토막 — 키·한글·축약 혼재를 표준 키로", () => {
  it("앱 폼 저장분(키)은 그대로", () => {
    expect(subjectTokens("math")).toEqual(["math"]);
  });
  it("옛 시트 이관분(한글·쉼표)은 표준 키로 바꾼다 — 학원설정 색이 붙게", () => {
    expect(subjectTokens("영어, 수학")).toEqual(["english", "math"]);
    expect(subjectTokens("수학")).toEqual(["math"]);
  });
  it("한 글자 축약 '영+수'도 편다", () => {
    expect(subjectTokens("영+수")).toEqual(["english", "math"]);
  });
  it("모르는 표기(EiE·프로그램명)는 그대로 둔다 — 글자는 살고 색만 없다", () => {
    expect(subjectTokens("EiE, 수학")).toEqual(["EiE", "math"]);
  });
  it("빈 값은 빈 배열", () => {
    expect(subjectTokens(null)).toEqual([]);
    expect(subjectTokens("")).toEqual([]);
  });
});

describe("결제 금액", () => {
  it("numeric 문자열을 원 단위 천 단위 구분으로", () => {
    expect(wonLabel("300000")).toBe("300,000원");
    expect(wonLabel("367875")).toBe("367,875원");
  });
  it("숫자가 아니면 원문 그대로, 빈 값은 null", () => {
    expect(wonLabel("영어 30만")).toBe("영어 30만");
    expect(wonLabel(null)).toBeNull();
    expect(wonLabel("")).toBeNull();
  });
});

describe("비고 줄 — 후속 조치·미등록 사유", () => {
  it("있는 것만 줄이 된다", () => {
    expect(
      noteLines({ followUpDate: "2026-09-03", followUpContent: "재통화", nonRegistrationReason: null }),
    ).toEqual(["조치 9/3 · 재통화"]);
    expect(noteLines({ followUpDate: null, followUpContent: null, nonRegistrationReason: "거리" })).toEqual([
      "미등록 사유: 거리",
    ]);
    expect(noteLines({ followUpDate: null, followUpContent: "  ", nonRegistrationReason: null })).toEqual([]);
  });
});

describe("상태 칸·범례 — outcome 원값 + 파생 배정", () => {
  it("범례는 outcome-meta의 7종을 순서대로 담고 '반 배정 완료'로 끝난다(라벨 맵을 새로 만들지 않는다)", () => {
    const labels = SHEET_LEGEND.map((l) => l.label);
    expect(labels.slice(0, -1)).toEqual(Object.values(OUTCOME_PILL).map((m) => m.label));
    expect(labels.at(-1)).toBe(ASSIGNED_LABEL);
  });
  it("상태 칸은 원값 라벨이다 — 칸반 4칸으로 뭉개지 않는다", () => {
    expect(statusCellOf({ outcome: "scheduled", assignedClassCount: 0 }).label).toBe(OUTCOME_PILL.scheduled!.label);
    expect(statusCellOf({ outcome: "no_show", assignedClassCount: 0 }).label).toBe(OUTCOME_PILL.no_show!.label);
  });
  it("배정(수강 ≥ 1)이 outcome을 이긴다 — 칸반과 같은 규칙", () => {
    expect(statusCellOf({ outcome: "consulted", assignedClassCount: 2 }).label).toBe(ASSIGNED_LABEL);
  });
});
