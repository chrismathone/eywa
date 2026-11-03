import { describe, expect, it } from "vitest";
import { basisText, buildSecretaryPrompt, noteSource, secretaryInput } from "./secretary-ai";
import { checkRows } from "./check-board";
import { secretaryBrief } from "./secretary-plan";
import { canRunFor } from "./secretary-schedule";
import { FIXTURE_EXTRAS, FIXTURE_SNAPSHOT } from "./testing/fixture";

const user = (system_role: string, status = "active") => ({ id: "u9", tenant_id: "t", system_role, status });

describe("업무 비서 예약 정리 — 누구에게 · 언제", () => {
  it("업무를 요청할 수 있는 재직자만(원장 · 관리자 · 매니저 · 업무 처리 현황 지정자)", () => {
    expect(canRunFor(user("master"), [], false)).toBe(true);
    expect(canRunFor(user("manager"), [], false)).toBe(true);
    expect(canRunFor(user("teacher"), [], false)).toBe(false);
    expect(canRunFor(user("teacher"), ["u9"], false)).toBe(true);
    expect(canRunFor(user("admin", "inactive"), [], false)).toBe(false);
    expect(canRunFor(undefined, [], true)).toBe(false);
  });
  it("시각 표기 — 오늘이면 '오늘 HH:MM', 아니면 날짜와 함께(KST)", () => {
    expect(basisText("2026-11-02T00:12:00Z", "2026-11-02")).toBe("오늘 09:12");
    expect(basisText("2026-11-01T12:10:00Z", "2026-11-02")).toBe("11/1 21:10");
    expect(basisText("2026-11-01T16:00:00Z", "2026-11-02")).toBe("오늘 01:00");
  });
  it("정리 출처 — 예약은 돌린 시각과 숫자 기준 시각을 함께", () => {
    expect(noteSource({ at: "2026-11-02T04:00:30Z", runKind: "schedule", basisAt: "2026-11-02T00:12:00Z" }, "2026-11-02")).toBe("AI 정리 · 13:00 예약 · 숫자 기준 오늘 09:12");
    expect(noteSource({ at: "2026-11-01T16:00:10Z", runKind: "schedule", basisAt: "2026-11-01T12:10:00Z" }, "2026-11-02")).toBe("AI 정리 · 01:00 예약 · 숫자 기준 11/1 21:10");
    expect(noteSource({ at: "2026-11-02T06:20:00Z", runKind: "button", basisAt: "2026-11-02T06:19:40Z" }, "2026-11-02")).toBe("AI 정리 · 15:20 직접");
  });
  it("예약 프롬프트의 '오늘'은 돌린 날 · 숫자는 기준 시각을 밝힌다", () => {
    const ctx = { snapshot: FIXTURE_SNAPSHOT, extras: FIXTURE_EXTRAS, amounts: true, subjects: [], eieOn: true, can: () => true };
    const input = secretaryInput(secretaryBrief(ctx, checkRows(ctx), null, true), FIXTURE_SNAPSHOT.today, "월", 2);
    expect(buildSecretaryPrompt(input, { today: "2026-11-03", weekday: "화", day: 3, basis: "11/2 21:10" })).toContain("[오늘] 2026-11-03(화) · 이번 달 3일째 · 아래 숫자는 11/2 21:10 기준");
    expect(buildSecretaryPrompt(input)).toContain("[오늘] 2026-11-02(월) · 이번 달 2일째\n");
  });
});
