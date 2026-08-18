import { describe, expect, it } from "vitest";
import { isRecallCleared, makeupRemoveMessage, planMakeupRemoval } from "./makeup-remove-plan";

/**
 * 보강 빼기 판정 — 🔴 핵심 안전 규약은 **"학부모에게 나간 글이 있는 행은 지우지 않는다"**.
 * 그 행이 게시글을 찾을 열쇠(share_token)를 쥐고 있어서, 먼저 지우면 학부모 게시판에 유령 글이 남는다.
 */
const row = (o: Partial<{ id: string; classnoteStatus: string | null; shareToken: string | null }> = {}) => ({
  id: "r1",
  classnoteStatus: null as string | null,
  shareToken: null as string | null,
  ...o,
});

describe("planMakeupRemoval", () => {
  it("미발송(상태 없음)은 바로 삭제", () => {
    const p = planMakeupRemoval([row()]);
    expect(p).toEqual({ deleteIds: ["r1"], recallIds: [], busyIds: [], manualIds: [] });
  });

  it("🔴 발송 완료는 삭제가 아니라 회수 — 먼저 지우면 학부모 게시글이 영원히 남는다", () => {
    const p = planMakeupRemoval([row({ classnoteStatus: "success", shareToken: "tok" })]);
    expect(p.recallIds).toEqual(["r1"]);
    expect(p.deleteIds).toEqual([]);
  });

  it("회수 실패분도 회수 재시도 대상(삭제 아님)", () => {
    const p = planMakeupRemoval([row({ classnoteStatus: "recall_failed", shareToken: "tok" })]);
    expect(p.recallIds).toEqual(["r1"]);
  });

  it("회수 완료(recalled)는 게시글이 이미 없으므로 삭제", () => {
    const p = planMakeupRemoval([row({ classnoteStatus: "recalled", shareToken: "tok" })]);
    expect(p.deleteIds).toEqual(["r1"]);
  });

  it("발송 대기·처리 중·회수 요청 중은 건드리지 않는다(워커가 집어간 작업)", () => {
    const p = planMakeupRemoval([
      row({ id: "a", classnoteStatus: "queued" }),
      row({ id: "b", classnoteStatus: "processing" }),
      row({ id: "c", classnoteStatus: "recall_requested", shareToken: "t" }),
    ]);
    expect(p.busyIds).toEqual(["a", "b", "c"]);
    expect(p.deleteIds).toEqual([]);
    expect(p.recallIds).toEqual([]);
  });

  it("🔴 게시는 됐는데 공유 토큰이 없으면 **지우지 않는다** — 지우면 게시글은 남고 흔적만 사라진다", () => {
    const p = planMakeupRemoval([row({ classnoteStatus: "success", shareToken: null })]);
    expect(p.manualIds).toEqual(["r1"]);
    expect(p.deleteIds).toEqual([]);
    expect(p.recallIds).toEqual([]);
  });

  it("발송이 애초에 안 된 상태들(실패·과목 제외)은 삭제", () => {
    const p = planMakeupRemoval([
      row({ id: "a", classnoteStatus: "failed" }),
      row({ id: "b", classnoteStatus: "subject_off" }),
      row({ id: "c", classnoteStatus: "too_old" }),
    ]);
    expect(p.deleteIds).toEqual(["a", "b", "c"]);
  });
});

describe("makeupRemoveMessage — 실제로 일어난 일만 적는다", () => {
  it("출결만 지운 경우", () => {
    expect(makeupRemoveMessage({ attendanceRemoved: true, deleted: 0, recalled: 0, busy: 0 })).toBe(
      "출결 기록을 지웠습니다",
    );
  });

  it("회수분은 '지웠습니다'로 뭉뚱그리지 않는다 — 게시글 삭제는 연동 PC가 뒤이어 한다", () => {
    const msg = makeupRemoveMessage({ attendanceRemoved: true, deleted: 0, recalled: 1, busy: 0 });
    expect(msg).toContain("게시글 삭제를 요청했습니다");
  });

  it("처리 중 건은 다시 시도하라고 알린다", () => {
    expect(makeupRemoveMessage({ attendanceRemoved: false, deleted: 0, recalled: 0, busy: 2 })).toContain(
      "끝난 뒤에 다시 시도",
    );
  });

  it("남의 보강이 섞였으면 남는다고 말한다(조용히 넘기면 '반만 빠졌다'가 된다)", () => {
    const msg = makeupRemoveMessage({
      attendanceRemoved: true,
      deleted: 1,
      recalled: 0,
      busy: 0,
      notMine: 2,
    });
    expect(msg).toContain("다른 선생님이 쓴 보강 2건은 그대로 남습니다");
  });

  it("아무것도 안 지웠으면 그렇게 말한다(거짓 성공 금지)", () => {
    expect(makeupRemoveMessage({ attendanceRemoved: false, deleted: 0, recalled: 0, busy: 0 })).toBe(
      "지울 기록이 없습니다",
    );
  });
});

describe("isRecallCleared — 🔴 NULL을 삼키면 미발송 보강이 화면에서 사라진다", () => {
  it("회수 요청·완료만 true", () => {
    expect(isRecallCleared("recall_requested")).toBe(true);
    expect(isRecallCleared("recalled")).toBe(true);
  });

  it("NULL·미발송·발송완료는 false(되살려야 하는 행)", () => {
    expect(isRecallCleared(null)).toBe(false);
    expect(isRecallCleared(undefined)).toBe(false);
    expect(isRecallCleared("success")).toBe(false);
    expect(isRecallCleared("queued")).toBe(false);
    expect(isRecallCleared("recall_failed")).toBe(false);
  });
});
