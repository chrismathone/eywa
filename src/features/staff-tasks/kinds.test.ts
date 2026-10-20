import { describe, expect, it } from "vitest";
import { closeReasonLabel, groupTaskState, taskKindLabel, taskState, TASK_KINDS } from "./kinds";

describe("할 일 상태", () => {
  const now = Date.parse("2026-10-20T12:00:00+09:00");
  it("열린 일은 기한이 지나면 늦음", () => {
    expect(taskState("open", "2026-10-20T11:00:00+09:00", now)).toBe("late");
    expect(taskState("open", "2026-10-21T00:00:00+09:00", now)).toBe("open");
    expect(taskState("open", null, now)).toBe("open");
    expect(taskState("done", "2026-10-19T00:00:00+09:00", now)).toBe("done");
  });

  it("묶음 알림의 대표 상태 — 열린 것이 하나라도 있으면 열림, 늦은 것이 있으면 늦음", () => {
    expect(groupTaskState(["done", "open", "late"])).toBe("late");
    expect(groupTaskState(["done", "open"])).toBe("open");
    expect(groupTaskState(["done", "cancelled"])).toBe("done");
    expect(groupTaskState(["expired", "done"])).toBe("expired");
    expect(groupTaskState(["cancelled"])).toBe("cancelled");
  });
});

describe("종류 이름 · 닫힌 까닭", () => {
  it("모든 종류가 이름과 처리 기준을 가진다", () => {
    for (const [kind, info] of Object.entries(TASK_KINDS)) {
      expect(info.label, kind).not.toBe("");
      expect(info.doneRule, kind).not.toBe("");
    }
    expect(taskKindLabel("attendance_absent_desk")).toBe("결석 확인 전화");
    expect(taskKindLabel("unknown_kind")).toBe("할 일");
  });

  it("DB가 쓰는 닫힌 까닭은 모두 한글로 보인다(raw 코드 노출 금지)", () => {
    for (const reason of ["sent", "revoked", "recalled", "deleted", "too_old", "deadline", "followup_done", "rescheduled", "cleared",
      "anomaly_resolved", "desk_settled", "not_absent", "stale", "video_arrived", "homework_cancelled", "upload_window", "video_removed",
      "video_assigned", "unassigned_window", "send_requested", "not_sendable", "approval_decided", "document_canceled", "turn_skipped",
      "withdrawal_acted", "withdrawal_canceled", "turn_changed", "help_answered"]) {
      expect(closeReasonLabel(reason), reason).toMatch(/[가-힣]/);
    }
  });
});
