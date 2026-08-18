import { describe, expect, it } from "vitest";
import { withdrawnRecordText, withdrawnSummaryText } from "./withdrawn-row";

describe("퇴원 한 줄 요약 — 이름 뒤 문장", () => {
  it("학교학년 · (퇴원일, 사유) — 원장 2026-08-18 표기 그대로", () => {
    expect(
      withdrawnSummaryText({ schoolGrade: "침산중2", endedOn: "2026-08-18", reason: "이사" }),
    ).toBe("침산중2 · (08-18, 이사)");
  });

  it("사유가 없으면 괄호 안에서 **사유만** 빠진다(날짜는 원장이 명시로 요구한 값이라 남는다)", () => {
    expect(withdrawnSummaryText({ schoolGrade: "침산중2", endedOn: "2026-08-18", reason: null })).toBe(
      "침산중2 · (08-18)",
    );
    // 공백만 적힌 사유도 '없음'이다 — `(08-18, )` 같은 반쪽 괄호를 만들지 않는다.
    expect(withdrawnSummaryText({ schoolGrade: "침산중2", endedOn: "2026-08-18", reason: "  " })).toBe(
      "침산중2 · (08-18)",
    );
  });

  it("날짜도 사유도 없으면 괄호를 통째로 뺀다(빈 괄호 금지)", () => {
    expect(withdrawnSummaryText({ schoolGrade: "침산중2", endedOn: null, reason: null })).toBe("침산중2");
  });

  it("학교·학년을 모르면 괄호만 남는다(그 자리를 '—'로 채우지 않는다)", () => {
    expect(withdrawnSummaryText({ schoolGrade: "", endedOn: "2026-08-18", reason: "졸업" })).toBe(
      "(08-18, 졸업)",
    );
    expect(withdrawnSummaryText({})).toBe("");
  });
});

describe("퇴원 행에 남은 기록 — 칸을 접어도 값은 안 사라진다", () => {
  it("기록이 하나도 없으면 빈 문자열(요약만 그린다)", () => {
    expect(withdrawnRecordText([{ slotStart: "16:20" }])).toBe("");
    expect(
      withdrawnRecordText([
        { slotStart: "16:20", attendance: null, attitude: null, progressNote: "   " },
      ]),
    ).toBe("");
    expect(withdrawnRecordText([])).toBe("");
  });

  it("사유는 출결에 붙여 읽는다 — '결석(병결)'", () => {
    expect(
      withdrawnRecordText([{ slotStart: "16:20", attendance: "결석", attendanceNote: "병결" }]),
    ).toBe("결석(병결)");
  });

  it("교시가 하나뿐이면 교시 시각을 안 붙인다(군더더기)", () => {
    expect(
      withdrawnRecordText([
        { slotStart: "16:20", attendance: "지각", attitude: "좋음", progressNote: "숙제 밀림" },
        { slotStart: "17:20" },
      ]),
    ).toBe("지각 · 태도 좋음 · 숙제 밀림");
  });

  it("값이 있는 교시가 둘 이상이면 어느 교시인지 앞에 붙인다", () => {
    expect(
      withdrawnRecordText([
        { slotStart: "16:20", attendance: "출석" },
        { slotStart: "17:20", attendance: "결석" },
      ]),
    ).toBe("16:20 출석 · 17:20 결석");
  });

  it("폼별 자유 입력(시험 점수·듣기 레벨)도 라벨과 함께 남는다", () => {
    expect(
      withdrawnRecordText([
        {
          slotStart: "16:20",
          extras: [
            { label: "시험 점수", value: "18/20" },
            { label: "듣기 레벨", value: null },
          ],
        },
      ]),
    ).toBe("시험 점수 18/20");
  });

  it("상태가 지워지고 사유만 남은 옛 행도 보인다(쓴 게 안 보이면 안 된다)", () => {
    expect(withdrawnRecordText([{ slotStart: "16:20", attendanceNote: "학원버스 지연" }])).toBe(
      "사유 학원버스 지연",
    );
  });
});
