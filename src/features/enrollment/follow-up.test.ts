import { describe, expect, it } from "vitest";
import { ASSIGNED_DRAG_BLOCKED, BOARD_STAGES, ENROLLED_REVERT_BLOCKED } from "./board-stages";
import {
  FOLLOW_UP_BEFORE_BLOCKED,
  FOLLOW_UP_DATE_PAST,
  FOLLOW_UP_RESULTS,
  FOLLOW_UP_REQUIRED_ERROR,
  initialFollowUpResult,
  parseFollowUpResult,
  resolveFollowUp,
  type FollowUpResult,
} from "./follow-up";

const today = "2026-10-22";
const run = (current: string, result: FollowUpResult | null, followUpDate: string | null = null, storedDate: string | null = null) =>
  resolveFollowUp({ current, result, followUpDate, storedDate, today });

describe("후속 조치 — 상담 끝난 건은 반드시 고르고, 고르면 칸이 따라 움직인다", () => {
  it("버튼의 이름·순서·상태가 칸반 네 칸과 완전히 같다", () => {
    expect(FOLLOW_UP_RESULTS.map(({ value, label }) => ({ value, label }))).toEqual(
      BOARD_STAGES.map(({ key, label }) => ({ value: key, label })),
    );
    // 상담 전 접수(필수 아님)에서 고르면 칸반 드롭과 같은 상태 — 다음 상담일은 넣어도 안 넣어도 된다.
    for (const stage of BOARD_STAGES) {
      expect(run("pending", stage.key)).toEqual({ outcome: stage.dropOutcome });
      expect(run("pending", stage.key, stage.key === "consulted" ? "2026-10-25" : null)).toEqual({ outcome: stage.dropOutcome });
    }
  });
  it("배포 전 열린 폼과 초안도 같은 상태로 받는다", () => {
    expect(parseFollowUpResult("declined")).toBe("unregistered");
    expect(parseFollowUpResult("next")).toBe("consulted");
    expect(parseFollowUpResult("bad-value")).toBeNull();
  });
  it("반 배정된 상담은 칸반처럼 등록 완료이며 수강 종료 전에는 다른 칸으로 보낼 수 없다", () => {
    const input = { current: "consulted", assignedClassCount: 1, today, storedDate: null, followUpDate: "2026-10-30" };
    expect(initialFollowUpResult("consulted", null, 1)).toBe("enrolled");
    expect(resolveFollowUp({ ...input, result: null })).toEqual({ outcome: "enrolled" });
    expect(resolveFollowUp({ ...input, result: "enrolled" })).toEqual({ outcome: "enrolled" });
    expect(resolveFollowUp({ ...input, result: "unregistered" })).toEqual({ error: ASSIGNED_DRAG_BLOCKED });
    expect(resolveFollowUp({ ...input, result: "consulted" })).toEqual({ error: ASSIGNED_DRAG_BLOCKED });
    expect(resolveFollowUp({ ...input, result: "before" })).toEqual({ error: ASSIGNED_DRAG_BLOCKED });
  });
  it("상담 완료 칸에 남는 저장은 후속 조치 없이 막는다(새 상담 · AI 완료 포함)", () => {
    expect(run("consulted", null)).toEqual({ error: FOLLOW_UP_REQUIRED_ERROR });
    expect(run("ai_done", null)).toEqual({ error: FOLLOW_UP_REQUIRED_ERROR });
  });

  it("상담 전 접수·이미 끝난 상담은 고르지 않아도 그대로 저장한다", () => {
    expect(run("pending", null)).toEqual({ outcome: "pending" });
    expect(run("enrolled", null)).toEqual({ outcome: "enrolled" });
    expect(run("no_show", null)).toEqual({ outcome: "no_show" });
  });

  it("등록·미등록을 고르면 칸반 상태를 바꾼다", () => {
    expect(run("consulted", "enrolled")).toEqual({ outcome: "enrolled" });
    expect(run("ai_done", "unregistered")).toEqual({ outcome: "declined" });
  });

  it("칸 안의 원래 값은 지킨다 — 노쇼를 미등록으로 저장해도 노쇼, AI 완료에 다음 상담을 잡아도 AI 완료", () => {
    expect(run("no_show", "unregistered")).toEqual({ outcome: "no_show" });
    expect(run("ai_done", "consulted", "2026-10-25")).toEqual({ outcome: "ai_done" });
    expect(run("scheduled", "before")).toEqual({ outcome: "scheduled" });
  });

  it("'상담 완료' = 결정 전 — 다음 상담일은 선택(원장 2026-10-26) · 넣으면 오늘 이후 · 저장돼 있던 날은 유지", () => {
    // 다음 상담이 없을 수도 있다 — 날짜 없이 저장된다
    expect(run("consulted", "consulted")).toEqual({ outcome: "consulted" });
    expect(run("ai_done", "consulted")).toEqual({ outcome: "ai_done" });
    expect(run("pending", "consulted")).toEqual({ outcome: "consulted" });
    // 저장돼 있던 날짜를 지우고 저장하면 날짜 없이 저장된다(폼의 날짜로 덮는다)
    expect(run("consulted", "consulted", null, "2026-10-30")).toEqual({ outcome: "consulted" });
    expect(run("consulted", "consulted", "2026-10-21")).toEqual({ error: FOLLOW_UP_DATE_PAST });
    expect(run("consulted", "consulted", "2026-10-22")).toEqual({ outcome: "consulted" });
    // 이미 저장돼 있던 지난 날짜는 그대로 받는다(기한 지남 알림이 그 건을 말한다)
    expect(run("consulted", "consulted", "2026-10-20", "2026-10-20")).toEqual({ outcome: "consulted" });
  });

  it("상담을 마친 건은 '상담 전'으로 돌릴 수 없다 — 필수 조치를 피하는 문이 된다", () => {
    expect(run("consulted", "before")).toEqual({ error: FOLLOW_UP_BEFORE_BLOCKED });
    expect(run("ai_done", "before", "2026-10-30")).toEqual({ error: FOLLOW_UP_BEFORE_BLOCKED });
    // 상담 전 접수·미등록은 '상담 전'을 고를 수 있다(필수 대상이 아니다) · 날짜는 선택, 넣으면 오늘 이후
    expect(run("pending", "before")).toEqual({ outcome: "pending" });
    expect(run("declined", "before")).toEqual({ outcome: "pending" });
    expect(run("pending", "before", "2026-10-21")).toEqual({ error: FOLLOW_UP_DATE_PAST });
  });

  it("등록·미등록·반 배정은 날짜 없이", () => {
    expect(run("consulted", "enrolled")).toEqual({ outcome: "enrolled" });
    expect(run("consulted", "unregistered")).toEqual({ outcome: "declined" });
    expect(resolveFollowUp({ current: "consulted", result: null, followUpDate: null, storedDate: null, today, assignedClassCount: 1 })).toEqual({ outcome: "enrolled" });
  });

  it("미등록이던 상담에 다음 상담을 잡으면 다시 상담 완료로 · 상담 전 접수도 상담 완료로", () => {
    expect(run("declined", "consulted", "2026-10-30")).toEqual({ outcome: "consulted" });
    expect(run("scheduled", "consulted", "2026-10-30")).toEqual({ outcome: "consulted" });
  });

  it("등록 완료를 다음 상담(상담 완료)으로 되돌리지 않는다 — 상태 변경과 같은 문장", () => {
    expect(run("enrolled", "consulted", "2026-10-30")).toEqual({ error: ENROLLED_REVERT_BLOCKED });
    expect(run("enrolled", "before")).toEqual({ error: ENROLLED_REVERT_BLOCKED });
    expect(run("enrolled", "unregistered")).toEqual({ outcome: "declined" });
  });

  it("처음 보여 줄 값은 지금 칸에서 읽는다", () => {
    expect(initialFollowUpResult("enrolled", null)).toBe("enrolled");
    expect(initialFollowUpResult("no_show", null)).toBe("unregistered");
    expect(initialFollowUpResult("ai_done", "2026-10-30")).toBe("consulted");
    expect(initialFollowUpResult("consulted", null)).toBeNull();
    expect(initialFollowUpResult("pending", "2026-10-30")).toBeNull();
    expect(initialFollowUpResult(undefined, null)).toBeNull();
  });
});
