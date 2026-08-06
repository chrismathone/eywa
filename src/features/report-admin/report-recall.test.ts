import { describe, expect, it } from "vitest";
import {
  RECALLED,
  RECALL_FAILED,
  RECALL_REQUESTED,
  isRecallInFlight,
  isRecallable,
  partitionRecallTargets,
  recallBlockReason,
} from "./report-recall";

const row = (classnoteStatus: string | null, shareToken: string | null = "tok") => ({ classnoteStatus, shareToken });

describe("회수 가능 판정", () => {
  it("게시 완료 + 공유 토큰 = 회수 가능", () => {
    expect(isRecallable(row("success"))).toBe(true);
    expect(recallBlockReason(row("success"))).toBeNull();
  });

  it("회수 실패는 재시도 허용", () => {
    expect(isRecallable(row(RECALL_FAILED))).toBe(true);
  });

  it("🔴 공유 토큰이 없으면 회수 불가 — 특정 못 하는 글은 지우지 않는다(남의 글 삭제 방지)", () => {
    expect(isRecallable(row("success", null))).toBe(false);
    expect(recallBlockReason(row("success", null))).toContain("직접 삭제");
  });

  it("미발송·발송 실패·발송 차단은 회수할 것이 없다", () => {
    for (const s of [null, "failed", "too_old", "name_conflict", "blocked_shared", "subject_off"]) {
      expect(isRecallable(row(s))).toBe(false);
      expect(recallBlockReason(row(s))).toBeTruthy();
    }
    expect(recallBlockReason(row(null))).toContain("발송되지 않은");
  });

  it("발송 처리 중엔 회수 불가 — 워커가 게시하는 중이라 지울 대상이 아직 없다", () => {
    for (const s of ["queued", "processing"]) {
      expect(isRecallable(row(s))).toBe(false);
      expect(recallBlockReason(row(s))).toContain("처리 중");
    }
  });

  it("이미 요청·완료된 회수는 중복 요청 불가", () => {
    expect(isRecallable(row(RECALL_REQUESTED))).toBe(false);
    expect(isRecallable(row(RECALLED))).toBe(false);
    expect(isRecallInFlight(RECALL_REQUESTED)).toBe(true);
    expect(isRecallInFlight("success")).toBe(false);
  });

  it("사유 문구에 raw 상태 코드를 노출하지 않는다(UI 규칙)", () => {
    for (const s of [null, "queued", "failed", RECALLED, RECALL_REQUESTED]) {
      const reason = recallBlockReason(row(s)) ?? "";
      expect(reason).not.toMatch(/queued|processing|success|failed|too_old|recall/);
    }
  });
});

describe("일괄 회수 분류", () => {
  it("가능/불가를 갈라 건수와 사유를 함께 돌려준다(조용히 버리지 않는다)", () => {
    const { targets, blocked } = partitionRecallTargets([
      { id: "a", ...row("success") },
      { id: "b", ...row(null) },
      { id: "c", ...row(RECALL_FAILED) },
      { id: "d", ...row("success", null) },
    ]);
    expect(targets).toEqual(["a", "c"]);
    expect(blocked.map((b) => b.id)).toEqual(["b", "d"]);
    expect(blocked[0]!.reason).toBeTruthy();
  });
});
