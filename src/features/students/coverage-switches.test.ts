import { describe, expect, it } from "vitest";
import { failedModuleConnectionCoverage, pendingStudentCoverageLabels } from "./coverage-switches";

describe("원생 자료 연결 상태의 기능 이름", () => {
  it("모든 기능이 켜진 지점은 종전 이름을 그대로 쓴다", () => {
    expect(pendingStudentCoverageLabels({ slackOn: true, ecountOn: true })).toEqual({
      external: "Google Drive·Notion·카카오톡/Slack",
      finance: "ECOUNT·학생별 수익 분석",
    });
    expect(failedModuleConnectionCoverage([])).toEqual([
      { key: "extras", label: "클래스노트·셔틀", state: "failed" },
    ]);
  });

  it("꺼진 기능은 조회 실패 문구와 준비 중 이름에도 남기지 않는다", () => {
    expect(pendingStudentCoverageLabels({ slackOn: false, ecountOn: false })).toEqual({
      external: "Google Drive·Notion·카카오톡",
      finance: "학생별 수익 분석",
    });
    expect(failedModuleConnectionCoverage(["classnote", "shuttle"])).toEqual([]);
    expect(failedModuleConnectionCoverage(["classnote"])).toEqual([
      { key: "extras", label: "셔틀", state: "failed" },
    ]);
  });
});
