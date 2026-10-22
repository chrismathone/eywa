import { describe, expect, it } from "vitest";
import { ENROLLED_REVERT_BLOCKED } from "./board-stages";
import {
  FOLLOW_UP_DATE_PAST,
  FOLLOW_UP_DATE_REQUIRED,
  FOLLOW_UP_REQUIRED_ERROR,
  initialFollowUpResult,
  resolveFollowUp,
} from "./follow-up";

const today = "2026-10-22";
const run = (current: string, result: "enrolled" | "declined" | "next" | null, followUpDate: string | null = null, storedDate: string | null = null) =>
  resolveFollowUp({ current, result, followUpDate, storedDate, today });

describe("후속 조치 — 상담 끝난 건은 반드시 고르고, 고르면 칸이 따라 움직인다", () => {
  it("상담 완료 칸에 남는 저장은 후속 조치 없이 막는다(새 상담 · AI 완료 포함)", () => {
    expect(run("consulted", null)).toEqual({ error: FOLLOW_UP_REQUIRED_ERROR });
    expect(run("ai_done", null)).toEqual({ error: FOLLOW_UP_REQUIRED_ERROR });
  });

  it("상담 전 접수·이미 끝난 상담은 고르지 않아도 그대로 저장한다", () => {
    expect(run("pending", null)).toEqual({ outcome: "pending", registrationStatus: null });
    expect(run("enrolled", null)).toEqual({ outcome: "enrolled", registrationStatus: null });
    expect(run("no_show", null)).toEqual({ outcome: "no_show", registrationStatus: null });
  });

  it("등록·미등록을 고르면 그 칸으로 옮기고 '등록 상태' 칸도 맞춘다", () => {
    expect(run("consulted", "enrolled")).toEqual({ outcome: "enrolled", registrationStatus: "등록완료" });
    expect(run("ai_done", "declined")).toEqual({ outcome: "declined", registrationStatus: "미등록" });
  });

  it("칸 안의 원래 값은 지킨다 — 노쇼를 미등록으로 저장해도 노쇼, AI 완료에 다음 상담을 잡아도 AI 완료", () => {
    expect(run("no_show", "declined")).toEqual({ outcome: "no_show", registrationStatus: "미등록" });
    expect(run("ai_done", "next", "2026-10-25")).toEqual({ outcome: "ai_done", registrationStatus: null });
  });

  it("다음 상담은 날짜가 있어야 하고, 새로 넣는 날짜는 오늘 이후", () => {
    expect(run("consulted", "next")).toEqual({ error: FOLLOW_UP_DATE_REQUIRED });
    expect(run("consulted", "next", "2026-10-21")).toEqual({ error: FOLLOW_UP_DATE_PAST });
    expect(run("consulted", "next", "2026-10-22")).toEqual({ outcome: "consulted", registrationStatus: null });
    // 이미 저장돼 있던 지난 날짜는 그대로 받는다(기한 지남 알림이 그 건을 말한다)
    expect(run("consulted", "next", "2026-10-20", "2026-10-20")).toEqual({ outcome: "consulted", registrationStatus: null });
  });

  it("미등록이던 상담에 다음 상담을 잡으면 다시 상담 완료로 · 상담 전 접수도 상담 완료로", () => {
    expect(run("declined", "next", "2026-10-30")).toEqual({ outcome: "consulted", registrationStatus: null });
    expect(run("scheduled", "next", "2026-10-30")).toEqual({ outcome: "consulted", registrationStatus: null });
  });

  it("등록 완료를 다음 상담(상담 완료)으로 되돌리지 않는다 — 상태 변경과 같은 문장", () => {
    expect(run("enrolled", "next", "2026-10-30")).toEqual({ error: ENROLLED_REVERT_BLOCKED });
    expect(run("enrolled", "declined")).toEqual({ outcome: "declined", registrationStatus: "미등록" });
  });

  it("처음 보여 줄 값은 지금 칸에서 읽는다", () => {
    expect(initialFollowUpResult("enrolled", null)).toBe("enrolled");
    expect(initialFollowUpResult("no_show", null)).toBe("declined");
    expect(initialFollowUpResult("ai_done", "2026-10-30")).toBe("next");
    expect(initialFollowUpResult("consulted", null)).toBeNull();
    expect(initialFollowUpResult("pending", "2026-10-30")).toBeNull();
    expect(initialFollowUpResult(undefined, null)).toBeNull();
  });
});
