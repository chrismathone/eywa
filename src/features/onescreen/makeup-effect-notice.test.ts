import { describe, expect, it } from "vitest";
import { makeupEffectNotice } from "./makeup-effect-notice";

describe("저장 후 보강 연결 안내", () => {
  it("후속 확인이 남아도 기록 저장 성공을 유지하고 재발송을 안내하지 않는다", () => {
    expect(makeupEffectNotice({ state: "pending", queued: true })).toMatch(/저장했습니다.*대기 중/);
    expect(makeupEffectNotice({ state: "unknown", queued: false })).toMatch(/저장했습니다.*완료하지 못했습니다/);
    expect(makeupEffectNotice({ state: "unknown", queued: false })).not.toMatch(/다시 발송/);
  });
  it("연결 관찰이나 알림이 없는 정상 저장에는 새 경고를 만들지 않는다", () => {
    for (const value of [undefined, null, {}, { state: "observation" }, { state: "done", queued: true }]) expect(makeupEffectNotice(value)).toBeNull();
  });
});
