import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/features/owner/defaults";
import { hiddenNotificationTypes } from "./module-visibility";

describe("기능별 벨 알림 숨김", () => {
  it("침산판(모듈 전부 켬)은 기존 알림을 감추지 않는다", () => {
    expect(hiddenNotificationTypes(DEFAULT_SETTINGS)).toEqual([]);
  });

  it("전자결재와 ClassNote를 끄면 그 기능에서 온 기존 알림을 모두 감춘다", () => {
    expect(hiddenNotificationTypes({
      ...DEFAULT_SETTINGS,
      modules: { ...DEFAULT_SETTINGS.modules, disabled: ["approvals", "classnote"] },
    })).toEqual([
      "approval_requested",
      "approval_decided",
      "approval_comment",
      "classnote_parent_post",
      "classnote_parent_comment",
    ]);
  });
});
