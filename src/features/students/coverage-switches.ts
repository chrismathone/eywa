import { isModuleEnabled, type ModuleId } from "@/lib/modules";

/** 준비 중인 연결 자료의 이름도 이 지점에 켜진 기능만 말한다. */
export function pendingStudentCoverageLabels(flags: { slackOn: boolean; ecountOn: boolean }) {
  return {
    external: flags.slackOn ? "Google Drive·Notion·카카오톡/Slack" : "Google Drive·Notion·카카오톡",
    finance: flags.ecountOn ? "ECOUNT·학생별 수익 분석" : "학생별 수익 분석",
  };
}

/** 연결 상태 조회 자체가 실패했을 때도 꺼진 모듈의 이름은 대신 보여 주지 않는다. */
export function failedModuleConnectionCoverage(disabled: readonly ModuleId[]) {
  const labels = [
    isModuleEnabled(disabled, "classnote") ? "클래스노트" : null,
    isModuleEnabled(disabled, "shuttle") ? "셔틀" : null,
  ].filter((label): label is string => label !== null);
  return labels.length > 0
    ? [{ key: "extras", label: labels.join("·"), state: "failed" as const }]
    : [];
}
