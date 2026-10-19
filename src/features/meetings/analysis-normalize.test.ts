import { describe, expect, it } from "vitest";
import { EMPTY_MEETING_ERROR, normalizeMeetingAnalysis } from "./analysis-normalize";

describe("normalizeMeetingAnalysis — 기존 저장본 모양으로", () => {
  const { report, speakerRoles } = normalizeMeetingAnalysis({
    speakerRoles: { A: "원장", B: "", C: 3 },
    meetingType: "정기 운영회의",
    summary: "- OKR을 논의했다.\n- 계약서를 1시간 내 보내기로 했다.",
    agendaDiscussion: "OKR 도입을 논의했다. 캘린더 기록도 다뤘다.",
    decisions: "- **원장(화자 A)**이 제안, **1시간 내** 발송",
    actionItems: ["**화자 F**: 계약서 발송", "- **화자 B(정유진 부원장)**: 일정 확인"],
    speakerSummary: "- **원장(A)**: 강조",
    concerns: "",
    nextSteps: "- 다음 주 재논의 **3시 반",
    extra: "버린다",
  });

  it("나열 섹션: 산문 → 불릿 · 배열 → 줄마다", () => {
    expect(report.agendaDiscussion).toBe("- OKR 도입을 논의했다.\n- 캘린더 기록도 다뤘다.");
    expect(report.actionItems).toBe("- **화자 F**: 계약서 발송\n- **정유진 부원장(B)**: 일정 확인");
  });
  it("산문 섹션: 불릿을 떼고 한 문단", () => {
    expect(report.summary).toBe("OKR을 논의했다. 계약서를 1시간 내 보내기로 했다.");
  });
  it("굵게는 허용 — 짝이 안 맞는 것만 뗀다", () => {
    expect(report.nextSteps).toBe("- 다음 주 재논의 3시 반");
    expect(report.decisions).toBe("- **원장(A)**이 제안, **1시간 내** 발송");
  });
  it("이미 기존 모양이면 그대로", () => {
    expect(report.speakerSummary).toBe("- **원장(A)**: 강조");
  });
  it("8섹션만 · 화자 역할은 글자 있는 것만", () => {
    expect(Object.keys(report).sort()).toEqual(
      ["actionItems", "agendaDiscussion", "concerns", "decisions", "meetingType", "nextSteps", "speakerSummary", "summary"],
    );
    expect(speakerRoles).toEqual({ A: "원장", C: "3" });
  });
  it("두 번 돌려도 같다", () => {
    expect(normalizeMeetingAnalysis({ ...report, speakerRoles }).report).toEqual(report);
  });
  it("섹션이 하나도 없으면 던진다 · 한 겹 싼 응답은 풀어서 읽는다", () => {
    expect(() => normalizeMeetingAnalysis({ speakerRoles: { A: "원장" } })).toThrow(EMPTY_MEETING_ERROR);
    expect(normalizeMeetingAnalysis({ result: { Summary: "요약했다." } }).report.summary).toBe("요약했다.");
  });
  it("참석자별 발언이 객체로 오면 발언자를 살린다", () => {
    const { report: r } = normalizeMeetingAnalysis({ speakerSummary: { "노원장(A)": "셔틀 노선 변경 제안", "정유진(B)": "일정 확인" } });
    expect(r.speakerSummary).toBe("- 노원장(A): 셔틀 노선 변경 제안\n- 정유진(B): 일정 확인");
  });
});
