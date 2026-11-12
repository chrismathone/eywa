import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { hiddenStaffTaskKinds } from "./task-visibility";

describe("기능별 할 일 숨김", () => {
  it("침산판(모듈 전부 켬 · ClassNote 발송 켬)은 종전처럼 모든 종류를 보인다", () => {
    expect(hiddenStaffTaskKinds({
      ...DEFAULT_SETTINGS,
      report: { ...DEFAULT_SETTINGS.report, classnoteSendEnabled: true },
    })).toEqual([]);
  });

  it("전자결재와 ClassNote 모듈을 끄면 닫을 수 없는 할 일을 감춘다", () => {
    expect(hiddenStaffTaskKinds({
      ...DEFAULT_SETTINGS,
      modules: { ...DEFAULT_SETTINGS.modules, disabled: ["approvals", "classnote"] },
      report: { ...DEFAULT_SETTINGS.report, classnoteSendEnabled: true },
    })).toEqual(["approval_turn", "unsent_report", "report_send_failed"]);
  });

  it("ClassNote 모듈이 켜져 있으면 실제 발송 스위치가 꺼져도 기존 할 일을 보인다", () => {
    expect(hiddenStaffTaskKinds({
      ...DEFAULT_SETTINGS,
      report: { ...DEFAULT_SETTINGS.report, classnoteSendEnabled: false },
    })).toEqual([]);
  });
});
